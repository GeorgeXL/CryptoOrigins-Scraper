// Simple health check endpoint that doesn't require any dependencies
// This will help us diagnose if the basic serverless function works

export default async function handler(req: any, res: any) {
  try {
    const envCheck = {
      timestamp: new Date().toISOString(),
      vercel: process.env.VERCEL || 'not set',
      nodeEnv: process.env.NODE_ENV || 'not set',
      databaseUrl: process.env.DATABASE_URL ? '✅ Set' : '❌ Not set',
      openaiKey: process.env.OPENAI_API_KEY ? '✅ Set' : '❌ Not set',
      googleKey: process.env.GOOGLE_API_KEY ? '✅ Set' : '❌ Not set',
      exaKey: process.env.EXA_API_KEY ? '✅ Set' : '❌ Not set',
      perplexityKey: process.env.PERPLEXITY_API_KEY ? '✅ Set' : '❌ Not set',
    };

    res.status(200).json({
      status: 'ok',
      message: 'Health check passed',
      environment: envCheck
    });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
  }
}

