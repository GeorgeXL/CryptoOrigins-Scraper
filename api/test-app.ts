// Test if we can load the main app
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

export default async function handler(req: any, res: any) {
  const results: any = {
    step: '',
    error: null,
    success: false
  };

  try {
    results.step = '1. Importing createApp';
    // @ts-ignore
    const { createApp } = await import("../dist/index.js");
    
    results.step = '2. Calling createApp()';
    const appContainer = await createApp();
    
    results.step = '3. Got app container';
    results.hasApp = !!appContainer.app;
    results.hasServer = !!appContainer.server;
    
    results.step = '4. Success!';
    results.success = true;
    
  } catch (error) {
    results.error = error instanceof Error ? error.message : String(error);
    results.errorStack = error instanceof Error ? error.stack : undefined;
  }

  res.setHeader('Content-Type', 'application/json');
  res.status(results.success ? 200 : 500).json(results);
}

