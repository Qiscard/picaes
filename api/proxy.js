// Vercel Serverless Function - 代理转发到后端 API
// 文件路径: api/proxy.js

const BACKEND = 'http://43.248.184.207:8383/api/process';

export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(204).end();

    // GET - 测试后端连通性
    if (req.method === 'GET') {
        const diag = { proxy: 'ok', backend: 'unknown', error: null, latency: null };
        try {
            const start = Date.now();
            const test = await fetch('http://43.248.184.207:8383/api/health', {
                signal: AbortSignal.timeout(8000),
            });
            diag.latency = Date.now() - start + 'ms';
            diag.backend = test.ok ? 'ok' : 'status_' + test.status;
            diag.backendBody = await test.text();
        } catch (e) {
            diag.backend = 'unreachable';
            diag.error = e.message;
            diag.code = e.code || e.cause?.code || 'UNKNOWN';
        }
        return res.status(200).json(diag);
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: '仅支持 POST 请求' });
    }

    try {
        // 读取原始请求体
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const bodyBuffer = Buffer.concat(chunks);

        if (bodyBuffer.length === 0) {
            return res.status(400).json({ error: '请求体为空' });
        }

        const response = await fetch(BACKEND, {
            method: 'POST',
            headers: {
                'Content-Type': req.headers['content-type'] || 'application/octet-stream',
            },
            body: bodyBuffer,
            signal: AbortSignal.timeout(60000),
        });

        const resultBuffer = Buffer.from(await response.arrayBuffer());

        if (!response.ok) {
            res.setHeader('Content-Type', 'application/json');
            return res.status(response.status).send(resultBuffer);
        }

        res.setHeader('Content-Type', response.headers.get('content-type') || 'image/png');
        res.setHeader('Content-Disposition', response.headers.get('content-disposition') || 'attachment; filename="result.png"');
        res.status(200).send(resultBuffer);

    } catch (err) {
        console.error('代理错误:', err.message, err.code, err.cause);
        res.status(502).json({
            error: '代理请求失败: ' + err.message,
            code: err.code || null,
            cause: err.cause?.message || null,
        });
    }
}

export const config = {
    api: { bodyParser: false },
};
