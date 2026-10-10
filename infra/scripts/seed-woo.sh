#!/usr/bin/env bash
set -e

echo "🚀 Starting WooCommerce seeding process..."

WP_POD=$(kubectl get pod -n urumi -l app.kubernetes.io/component=app -o jsonpath="{.items[0].metadata.name}")
if [ -z "$WP_POD" ]; then
  echo "Error: WordPress pod not found."
  exit 1
fi

echo "WP Pod: $WP_POD"
echo "⏳ Downloading WP-CLI..."
kubectl exec -n urumi "$WP_POD" -- sh -c "curl -s -O https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar && chmod +x wp-cli.phar && mv wp-cli.phar /usr/local/bin/wp" || true

echo "⏳ Installing WordPress..."
kubectl exec -n urumi "$WP_POD" -- su -s /bin/sh www-data -c "wp core install --url=http://shop.urumi.local --title='Urumi Shop' --admin_user=admin --admin_password=password --admin_email=admin@urumi.local" || echo "WordPress already installed"

echo "⏳ Configuring WordPress URLs to match Ingress..."
kubectl exec -n urumi "$WP_POD" -- su -s /bin/sh www-data -c "wp option update siteurl http://shop.urumi.local"
kubectl exec -n urumi "$WP_POD" -- su -s /bin/sh www-data -c "wp option update home http://shop.urumi.local"

echo "⏳ Installing and activating WooCommerce..."
kubectl exec -n urumi "$WP_POD" -- su -s /bin/sh www-data -c "wp plugin is-installed woocommerce || wp plugin install woocommerce --version=8.7.0 --activate"

echo "⏳ Updating WooCommerce database..."
kubectl exec -n urumi "$WP_POD" -- su -s /bin/sh www-data -c "wp wc update"

echo "⏳ Enabling Cash on Delivery (COD)..."
kubectl exec -n urumi "$WP_POD" -- su -s /bin/sh www-data -c "wp wc payment_gateway update cod --settings='{\"enabled\":\"yes\"}' --user=admin || wp option update woocommerce_cod_settings '{\"enabled\":\"yes\",\"title\":\"Cash on delivery\",\"description\":\"Pay with cash upon delivery.\",\"instructions\":\"Pay with cash upon delivery.\"}'"

PRODUCT_EXISTS=$(kubectl exec -n urumi "$WP_POD" -- su -s /bin/sh www-data -c "wp wc product list --user=admin --format=count" || echo "0")
if [ "$PRODUCT_EXISTS" = "0" ]; then
  echo "⏳ Creating sample product..."
  kubectl exec -n urumi "$WP_POD" -- su -s /bin/sh www-data -c "wp wc product create --name='Urumi T-Shirt' --regular_price='19.99' --description='A high quality t-shirt.' --status='publish' --user=admin"
else
  echo "Products already exist."
fi

echo "⏳ Creating WooCommerce REST API keys..."
EXISTING_SECRET=$(kubectl get secret urumi-woo-api -n urumi --ignore-not-found -o jsonpath="{.metadata.name}")

if [ -z "$EXISTING_SECRET" ]; then
  # Dynamically inject create-key.php
  kubectl exec -n urumi "$WP_POD" -- su -s /bin/sh www-data -c "cat << 'PHP_EOF' > /tmp/create-key.php
<?php
\$user_id = 1;
\$description = 'MCP';
\$consumer_key = 'ck_' . wc_rand_hash();
\$consumer_secret = 'cs_' . wc_rand_hash();

global \$wpdb;
\$wpdb->insert(
    \$wpdb->prefix . 'woocommerce_api_keys',
    array(
        'user_id'         => \$user_id,
        'description'     => \$description,
        'permissions'     => 'read_write',
        'consumer_key'    => wc_api_hash( \$consumer_key ),
        'consumer_secret' => \$consumer_secret,
        'truncated_key'   => substr( \$consumer_key, -7 )
    )
);

echo \$consumer_key . '|' . \$consumer_secret;
PHP_EOF"

  KEYS=$(kubectl exec -n urumi "$WP_POD" -- su -s /bin/sh www-data -c "wp eval-file /tmp/create-key.php")
  
  CONSUMER_KEY=$(echo "$KEYS" | cut -d'|' -f1)
  CONSUMER_SECRET=$(echo "$KEYS" | cut -d'|' -f2)
  
  if [ -n "$CONSUMER_KEY" ] && [ -n "$CONSUMER_SECRET" ]; then
    echo "Creating Kubernetes Secret urumi-woo-api..."
    kubectl create secret generic urumi-woo-api -n urumi \
      --from-literal=WOOCOMMERCE_CONSUMER_KEY="$CONSUMER_KEY" \
      --from-literal=WOOCOMMERCE_CONSUMER_SECRET="$CONSUMER_SECRET"
  else
    echo "Failed to extract API keys. Output:"
    echo "$KEYS"
    exit 1
  fi
else
  echo "✅ WooCommerce API Secret already exists."
fi

echo "⏳ Installing REST API Host Fix MU-Plugin..."
kubectl exec -n urumi "$WP_POD" -- sh -c "mkdir -p /var/www/html/wp-content/mu-plugins"
kubectl exec -n urumi "$WP_POD" -- sh -c "cat << 'PHP_EOF' > /var/www/html/wp-content/mu-plugins/wc-rest-host-fix.php
<?php
add_filter('home_url', function(\$url, \$path, \$orig_scheme, \$blog_id) {
    if (isset(\$_SERVER['HTTP_HOST']) && strpos(\$_SERVER['REQUEST_URI'] ?? '', '/wc/v') !== false) {
        \$host = \$_SERVER['HTTP_HOST'];
        return \"http://\$host\" . \$path;
    }
    return \$url;
}, 10, 4);

add_filter('site_url', function(\$url, \$path, \$scheme, \$blog_id) {
    if (isset(\$_SERVER['HTTP_HOST']) && strpos(\$_SERVER['REQUEST_URI'] ?? '', '/wc/v') !== false) {
        \$host = \$_SERVER['HTTP_HOST'];
        return \"http://\$host\" . \$path;
    }
    return \$url;
}, 10, 4);
PHP_EOF"
kubectl exec -n urumi "$WP_POD" -- sh -c "chown -R www-data:www-data /var/www/html/wp-content/mu-plugins"

echo "🎉 WooCommerce setup complete!"
