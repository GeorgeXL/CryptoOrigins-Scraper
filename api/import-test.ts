export default async function handler(_req: any, res: any) {
  try {
    const module = await import("../dist/server/serverless.js");
    res.status(200).json({
      success: true,
      keys: Object.keys(module),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

