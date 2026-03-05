import axios from 'axios';
import cors from 'cors';
import { NextApiRequest, NextApiResponse } from 'next';

// Helper to run middleware in Vercel functions
const runMiddleware = (req: any, res: any, fn: any) =>
  new Promise((resolve, reject) => {
    fn(req, res, (result: any) => (result instanceof Error ? reject(result) : resolve(result)));
  });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // 1. Setup CORS
  await runMiddleware(req, res, cors({ methods: ['GET', 'POST', 'OPTIONS'] }));

  const { targetUrl } = req.query;
  if (!targetUrl) return res.status(400).json({ error: 'Missing targetUrl' });

  // 2. Setup Axios with your Proxy Credentials
  const instance = axios.create({
    proxy: {
      protocol: 'http',
      host: '23.95.150.145',
      port: 6114,
      auth: {
        username: 'ublgpuwb',
        password: '2odgwm27cgt5'
      }
    },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    },
    timeout: 10000 // 10 second limit
  });

  try {
    const response = await instance.get(targetUrl as string);
    res.status(200).send(response.data);
  } catch (error: any) {
    console.error('Scrape Error:', error.message);
    res.status(500).json({ error: 'Failed to fetch through proxy' });
  }
}
