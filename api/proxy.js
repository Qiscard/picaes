// Vercel Serverless Function - 代理转发到后端 API
// 文件路径: api/proxy.js
// 解决 Vercel HTTPS → 后端 HTTP 的 Mixed Content 问题

export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(204).end();

    // GET 请求返回 API 信息
    if (req.method === 'GET') {
        return res.status(200).json({
            status: 'ok',
            message: '图片加密/解密 API 代理',
            usage: {
                method: 'POST',
                params: {
                    image: '图片文件 (multipart/form-data)',
                    level: '加密等级 1-10',
                    key: '密钥 (可选, 默认 tool.hadsky.com)',
                    mode: 'encrypt 或 decrypt (可选, 默认 encrypt)'
                }
            }
        });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: '仅支持 POST 请求' });
    }

    try {
        const BACKEND = 'http://43.248.184.207:8383/api/process';

        // 读取原始请求体（multipart/form-data），保持原样转发
        const chunks = [];
        for await (const chunk of req) {
            chunks.push(chunk);
        }
        const bodyBuffer = Buffer.concat(chunks);

        if (bodyBuffer.length === 0) {
            return res.status(400).json({ error: '请求体为空，请上传图片' });
        }

        const response = await fetch(BACKEND, {
            method: 'POST',
            headers: {
                'Content-Type': req.headers['content-type'] || 'application/octet-stream',
                'Content-Length': bodyBuffer.length.toString(),
            },
            body: bodyBuffer,
        });

        const resultBuffer = Buffer.from(await response.arrayBuffer());

        if (!response.ok) {
            res.setHeader('Content-Type', 'application/json');
            return res.status(response.status).send(resultBuffer);
        }

        // 后端返回图片，直接透传
        res.setHeader('Content-Type', response.headers.get('content-type') || 'image/png');
        res.setHeader('Content-Disposition', response.headers.get('content-disposition') || 'attachment; filename="result.png"');
        res.status(200).send(resultBuffer);

    } catch (err) {
        console.error('代理错误:', err.message);
        res.status(500).json({ error: '代理请求失败: ' + err.message });
    }
}

export const config = {
    api: {
        bodyParser: false, // 必须禁用，否则 multipart 会被解析失败
    },
};
