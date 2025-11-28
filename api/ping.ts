export default function handler(_req: any, res: any) {
  res.status(200).json({
    message: "Ping ok",
    timestamp: new Date().toISOString(),
    env: {
      NODE_ENV: process.env.NODE_ENV,
      HAS_DATABASE_URL: Boolean(process.env.DATABASE_URL),
      HAS_POSTGRES_URL: Boolean(process.env.POSTGRES_URL),
    },
  });
}

