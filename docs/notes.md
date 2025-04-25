# YapBay API Notes

- refactor routes.ts 1248 lines

- auto cancel

log just for event listener

## admin dash

Create an Admin Login Endpoint:
Since the dashboard needs separate auth, set up a simple backend service (or extend the YapBay API) to handle admin logins. For simplicity, assume a new endpoint POST /admin/login (you can host this temporarily on a minimal Node.js/Express server or Firebase Functions).
Example endpoint logic:
Accept username and password (e.g., hardcoded or stored in a secure database for just you).
Return a JWT token with a claim like admin: true.
Store credentials securely (e.g., hashed passwords in a database or environment variables).
