import axios from 'axios';
import cors from 'cors';
import { NextApiRequest, NextApiResponse } from 'next';

const runMiddleware = (req: any, res: any, fn: any) =>
  new Promise((resolve, reject) => {
    fn(req, res, (result: any) => (result instanceof Error ? reject(result) : resolve(result)));
  });

// YOUR PROVIDED PROXY POOL
const PROXY_POOL = [
  { host: '23.95.150.145', port: 6114 },
  { host: '198.23.239.134', port: 6540 },
  { host: '107.172.163.27', port: 6543 },
  { host: '216.10.27.159', port: 6837 }
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, cors({ methods: ['GET'] }));

  const { targetUrl } = req.query;
  if (!targetUrl) return res.status(400).json({ error: 'No URL provided' });

  // Rotate: Pick a random proxy from the pool
  const proxy = PROXY_POOL[Math.floor(Math.random() * PROXY_POOL.length)];

  const config = {
    method: 'get',
    url: targetUrl as string,
    proxy: {
      protocol: 'http',
      host: proxy.host,
      port: proxy.port,
      auth: {
        username: 'ublgpuwb',
        password: '2odgwm27cgt5'
      }
    },
    timeout: 10000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    }
  };

  try {
    const response = await axios(config);
    res.status(200).send(response.data);
  } catch (error: any) {
    console.error(`Proxy ${proxy.host} failed:`, error.message);
    res.status(500).json({ error: 'Proxy Rotation Failure' });
  }
}
