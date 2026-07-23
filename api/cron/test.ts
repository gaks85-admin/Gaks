export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method Not Allowed'
    });
  }

  console.log("[TEST CRON] Request reached");

  return res.status(200).json({
    success: true,
    message: "Cron endpoint reached"
  });
}
