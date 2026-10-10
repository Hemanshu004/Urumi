import * as jose from 'jose';

async function run() {
  const secret = new TextEncoder().encode("88nKw26Gelz9DC02gPmAxWPrjgDYPoeX");
  const token = await new jose.SignJWT({ id: 1, role: "admin", username: "admin" })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('2h')
    .sign(secret);
    
  const msg = {
    message: "Show me the open issues in the hemanshu004/urumi repository."
  };
  
  const res = await fetch("http://api.urumi.local/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": `token=${token}`
    },
    body: JSON.stringify(msg)
  });
  
  const text = await res.text();
  console.log("Status:", res.status);
  console.log("Response:", text);
}
run();
