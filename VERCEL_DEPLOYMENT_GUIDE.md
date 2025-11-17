# Vercel Deployment Guide

## Fixed Issues ✅

1. **Package Manager Mismatch**: Changed from `pnpm` to `npm` in `vercel.json`
2. **Missing Export**: Created `server/serverless.ts` to properly export `createApp` for Vercel
3. **Build Configuration**: Updated build command to create `dist/server/serverless.js` with proper exports
4. **Function Configuration**: Added function timeout configuration to `vercel.json`

## Environment Variables Required in Vercel

You MUST set these environment variables in your Vercel project settings:

### Database (Required)
- `DATABASE_URL` - Your Supabase PostgreSQL connection string
  - Format: `postgresql://user:password@host:port/database?sslmode=require`
  - Get this from your Supabase project settings > Database > Connection string (Session pooling)

### AI Services (At least one required)
- `OPENAI_API_KEY` - For OpenAI GPT models
- `GOOGLE_API_KEY` - For Google Gemini models  
- `ANTHROPIC_API_KEY` - For Anthropic Claude models (if used)

### News Services (Optional but recommended)
- `EXA_API_KEY` - For Exa news search
- `PERPLEXITY_API_KEY` - For Perplexity news search

## Deployment Steps

### 1. Push Your Changes to Git
```bash
git add .
git commit -m "Fix Vercel deployment configuration"
git push origin main
```

### 2. In Vercel Dashboard

1. Go to your project settings
2. Navigate to **Environment Variables**
3. Add all required variables listed above
4. Make sure to add them for **Production**, **Preview**, and **Development** environments

### 3. Trigger a New Deployment

Option A: Push a commit to trigger automatic deployment
Option B: In Vercel Dashboard > Deployments > Click "Redeploy"

### 4. Monitor the Build

1. Watch the build logs in Vercel
2. Look for these success indicators:
   - ✅ `vite build` completes successfully
   - ✅ `esbuild server/serverless.ts` creates `dist/server/serverless.js`
   - ✅ Build completes without errors

### 5. Test Your Deployment

After deployment completes, test these endpoints:

1. **Health Check**: `https://your-app.vercel.app/api/debug`
   - Should show environment variables status
   - Should show database connection status
   - Use this to diagnose any issues

2. **Main App**: `https://your-app.vercel.app/`
   - Should load your application

## Common Issues & Solutions

### Issue: "Cannot find module '../dist/server/serverless.js'"
**Solution**: The build didn't complete. Check:
- Build logs in Vercel
- Make sure `npm run build` succeeds locally
- Verify `dist/server/serverless.js` is created during build

### Issue: "DATABASE_URL is not set"
**Solution**: 
- Add `DATABASE_URL` in Vercel environment variables
- Redeploy after adding variables

### Issue: Database connection timeout
**Solution**:
- Make sure your Supabase database allows connections from Vercel
- Use the **Session pooling** connection string (not Transaction pooling)
- Verify `sslmode=require` is in the connection string

### Issue: "Module not found" errors during build
**Solution**:
- Make sure all dependencies are in `dependencies` (not `devDependencies`)
- Run `npm install` locally to verify package.json is correct

### Issue: Function timeout (10 seconds default)
**Solution**: 
- Already configured in `vercel.json` with 60 second timeout
- If you need more, upgrade your Vercel plan

## Debugging

### Check Deployment Logs
1. Go to Vercel Dashboard > Your Project > Deployments
2. Click on the latest deployment
3. View "Building" and "Functions" logs

### Use the Debug Endpoint
Visit: `https://your-app.vercel.app/api/debug`

This shows:
- Environment variables status
- Database connection status
- Server configuration

### Compare with Working Project
Your working project (`crypto-origins-web`) likely has:
- All environment variables properly set
- Proper database connection string
- Similar build configuration

Check that project's environment variables and copy them over if needed.

## Verification Checklist

- [ ] All environment variables added to Vercel
- [ ] Build completes without errors
- [ ] `/api/debug` endpoint returns success
- [ ] Database connection works (shown in debug endpoint)
- [ ] Main application loads at root URL
- [ ] No 500 errors in function logs

## Need Help?

If deployment still fails:
1. Check build logs in Vercel
2. Check function logs (Runtime Logs)
3. Visit `/api/debug` to see what's failing
4. Compare environment variables with your working project

