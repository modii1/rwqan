# Cloudflare Turnstile CAPTCHA Setup Guide

## ⚠️ Important: This Is NOT Firebase

**Turnstile keys do NOT go in Firebase Console.**

- **Turnstile**: Managed in [Cloudflare Dashboard](https://dash.cloudflare.com/)
- **Firebase**: Managed in [Firebase Console](https://console.firebase.google.com/)

They are completely separate services. This guide covers **Cloudflare Turnstile only**.

---

## Overview
This project uses **Cloudflare Turnstile** for CAPTCHA verification on the property registration form (account creation). Follow the steps below to get your API keys and configure the application.

---

## Step 1: Create a Cloudflare Account

1. Go to [https://dash.cloudflare.com/](https://dash.cloudflare.com/)
2. Sign up for a free account (or log in if you already have one)
3. Complete the email verification

---

## Step 2: Create a Turnstile Site

1. In the Cloudflare Dashboard, go to **Account Home** (top-left)
2. Click on **Turnstile** in the left sidebar (under Tools & Resources)
3. Click **Create Site** button
4. Fill in the form:
   - **Site name**: `rwqan.sa` (or any descriptive name)
   - **Domains**: Add your domain(s):
     - `localhost:3000` (for local development)
     - `localhost:3001` (if using a different port)
     - `localhost:5000` (if your local app runs on port 5000)
     - `rwqan.sa` (production domain)
     - `www.rwqan.sa` (if applicable)
   - **Bot Fight Mode**: Enable (recommended) or leave as is
   - **Mode**: Choose **Managed** (Turnstile handles challenge mode automatically)

5. Click **Create**

---

## Step 3: Retrieve Your Keys

After creation, you'll see a screen with two keys:

- **Site Key** (Public): `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
  - Use in frontend code
  - Safe to expose in browser
  - Example: `0x4AAAAAAAA_really_long_string`

- **Secret Key** (Private): `TURNSTILE_SECRET_KEY`
  - Use only on backend/server
  - **NEVER expose this in frontend code or git**
  - Example: `0x4AAAAAAAA_secret_really_long_string`

---

---

## Step 4: Set Environment Variables

### ❌ NOT in Firebase Console
**Do NOT add these to Firebase Console** — they don't belong there.

Firebase Console is for Firebase services (Firestore, Auth, Storage, etc.).  
Turnstile keys are for Cloudflare services (CAPTCHA).

### ✅ Where to Actually Set Them

See [TURNSTILE_DEPLOYMENT.md](TURNSTILE_DEPLOYMENT.md) for:
- Local development (`.env.local`)
- Vercel production
- Railway, Replit, Heroku, AWS, Docker, etc.

### For Local Development

Create/edit `.env.local` in your project root:

```bash
# Cloudflare Turnstile CAPTCHA
TURNSTILE_SECRET_KEY=0x4AAAAAAAA_your_secret_key_here
NEXT_PUBLIC_TURNSTILE_SITE_KEY=0x4AAAAAAAA_your_site_key_here
```



### For Production/Deployment

**See [TURNSTILE_DEPLOYMENT.md](TURNSTILE_DEPLOYMENT.md)** for detailed instructions:
- Vercel (if deploying frontend there)
- Railway, Replit, Heroku, AWS, Docker, etc.
- How to set environment variables on each platform

---

## Step 5: Verify Installation

### Frontend Check
The Turnstile widget should appear on the Step 3 (Payment) form with:
- A "Verify you are human" checkbox
- Optional challenge (may appear based on risk assessment)

### Backend Check
After submitting a registration:
1. Token should be sent to `/api/properties/register`
2. Server verifies it against Cloudflare
3. If valid, property registration proceeds
4. If invalid, returns: `"فشل التحقق من CAPTCHA، يرجى المحاولة مرة أخرى"`

---

## Testing

### Local Testing
1. Set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` to your Turnstile site key
2. Set `TURNSTILE_SECRET_KEY` to your Turnstile secret key
3. Run: `npm run dev`
4. Navigate to subscription page → Step 3
5. You should see the Turnstile widget
6. Complete the verification and submit

### Test Mode (Optional)
Turnstile provides test keys for development:
- **Site Key**: `1x00000000000000000000AA`
- **Secret Key**: `1x0000000000000000000000000000000000000000`

These always pass verification. Replace with real keys for production.

---

## Troubleshooting

### Widget Not Showing
- Check `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set correctly
- Ensure the domain in Cloudflare Turnstile settings matches your current domain
- Check browser console for errors

### "Skipping CAPTCHA verification" (Server Logs)
- `TURNSTILE_SECRET_KEY` environment variable not set on the server
- Registration still works but CAPTCHA is bypassed (logs warning)

### Verification Failed
- Secret key is incorrect or expired
- Token was sent with delay (tokens expire quickly)
- Cloudflare service is down (rare; falls back gracefully)

### Error: "problem with challenges.cloudflare.com"
If users see Cloudflare text like:
"This error may be caused by a problem with challenges.cloudflare.com, which is preventing the security verification process from completing"

Check the following in order:
1. Verify Cloudflare status: [status.cloudflare.com](https://status.cloudflare.com)
2. Disable ad blockers/privacy extensions and retry (they can block `challenges.cloudflare.com`)
3. Disable VPN/proxy or try another network (corporate/firewall DNS can block Turnstile)
4. Ensure system date/time is correct on the client device
5. Confirm your exact frontend domain is added in Turnstile site settings:
  - include local domains like `localhost:3000`
  - include current local port if different (example: `localhost:5000`)
  - include production domains like `rwqan.sa` and `www.rwqan.sa`
6. Check backend logs for `Turnstile verification failed` and review `errorCodes`

### Error code `110200` (Domain not authorized)
- This means your current hostname is not in Turnstile Hostname Management.
- If developing on this project, add `localhost:5000` in Cloudflare Turnstile site settings.
- After updating hostnames, hard refresh the page and retry the challenge.

If this happens only on one device/network, it is usually a local network/extension issue, not your backend.

### 400 Error: "يرجى إكمال التحقق"
- User didn't complete the CAPTCHA before submitting
- Verify that `captchaToken` is being sent in the request

---

## Code Locations

**Backend CAPTCHA Verification:**
- File: [server/routes/public.ts](server/routes/public.ts#L124-L157)
- Endpoint: `POST /api/properties/register`
- Verification: Cloudflare Turnstile siteverify API

**Frontend CAPTCHA Widget:**
- File: [src/components/subscriptions/subscription-page.tsx](../../src/components/subscriptions/subscription-page.tsx)
- Component: `<Turnstile ... />`
- Location: Step 3 (Payment form)
- Library: `@marsidev/react-turnstile`

---

## Security Notes

✅ **Best Practices:**
- Never commit `TURNSTILE_SECRET_KEY` to git
- Always use `.env.local` for local development
- Re-verify tokens on the server (never trust client-side validation)
- Regenerate keys if accidentally exposed

❌ **Never Do:**
- Hardcode keys in source code
- Expose secret key in frontend code
- Use test keys in production
- Share your secret key publicly

---

## More Resources

- [Cloudflare Turnstile Documentation](https://developers.cloudflare.com/turnstile/)
- [@marsidev/react-turnstile NPM](https://www.npmjs.com/package/@marsidev/react-turnstile)
- [Turnstile API Reference](https://developers.cloudflare.com/turnstile/get-started/)

---

## Support

If you encounter issues:
1. Check Cloudflare status: [status.cloudflare.com](https://status.cloudflare.com)
2. Review browser console for frontend errors
3. Check server logs for backend errors
4. Verify domain is in your Turnstile site settings
5. Try using test keys to isolate the issue
