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
