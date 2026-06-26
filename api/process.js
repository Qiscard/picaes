// Vercel Serverless Function - 图片加密/解密（纯 Vercel，无需外部服务器）
// 文件路径: api/process.js
const sharp = require('sharp');

// ==================== 混淆算法 ====================
const DEFAULT_KEY = 'hadsky.com';

function getRnd(key, num) {
    let idx = num % key.length;
    idx = key.charCodeAt(idx) % key.length;
    idx = parseFloat('0.' + idx);
    return parseInt(idx * num);
}

function shuffleEncrypt(blocks, userKey) {
    blocks.reverse();
    for (let i = blocks.length - 1; i > 0; i--) {
        const j = getRnd(DEFAULT_KEY, i + 1);
        [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
    }
    if (userKey) {
        for (let i = blocks.length - 1; i > 0; i--) {
            const j = getRnd(userKey, i + 1);
            [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
        }
    }
    return blocks;
}

function shuffleDecrypt(blocks, userKey) {
    if (userKey) {
        for (let i = 0; i < blocks.length; i++) {
            const j = getRnd(userKey, i + 1);
            [blocks[j], blocks[i]] = [blocks[i], blocks[j]];
        }
    }
    for (let i = 0; i < blocks.length; i++) {
        const j = getRnd(DEFAULT_KEY, i + 1);
        [blocks[j], blocks[i]] = [blocks[i], blocks[j]];
    }
    blocks.reverse();
    return blocks;
}

// ==================== 核心处理：只用 Sharp 解码/编码各一次 ====================
async function processImage(imageBuffer, level, key, mode) {
    const N = level * 10; // 等级 4 → 40×40 = 1600 块

    // Sharp 解码：图片 → raw 像素 buffer（只调一次）
    const image = sharp(imageBuffer);
    const meta = await image.metadata();
    const imgW = meta.width;
    const imgH = meta.height;
    const ch = meta.channels || 3;
    const rawBuf = await image.raw().toBuffer();

    const blockW = Math.floor(imgW / N);
    const blockH = Math.floor(imgH / N);
    const srcStride = imgW * ch;        // 原图每行字节数
    const blkStride = blockW * ch;      // 每个小块每行字节数

    // 从 rawBuf 中切出所有方块（纯内存操作，零 Sharp 调用）
    const blocks = [];
    for (let row = 0; row < N; row++) {
        for (let col = 0; col < N; col++) {
            const blockBuf = Buffer.alloc(blockH * blkStride);
            const srcX = col * blockW;
            const srcY = row * blockH;
            for (let y = 0; y < blockH; y++) {
                const srcOff = (srcY + y) * srcStride + srcX * ch;
                const dstOff = y * blkStride;
                rawBuf.copy(blockBuf, dstOff, srcOff, srcOff + blkStride);
            }
            blocks.push(blockBuf);
        }
    }

    // 混淆/解混淆
    if (mode === 'encrypt') {
        shuffleEncrypt(blocks, key);
    } else {
        shuffleDecrypt(blocks, key);
    }

    // 把打乱后的方块拼回 rawBuf（纯内存操作，零 Sharp 调用）
    for (let i = 0; i < blocks.length; i++) {
        const row = Math.floor(i / N);
        const col = i % N;
        const blockBuf = blocks[i];
        const dstX = col * blockW;
        const dstY = row * blockH;
        for (let y = 0; y < blockH; y++) {
            const srcOff = y * blkStride;
            const dstOff = (dstY + y) * srcStride + dstX * ch;
            blockBuf.copy(rawBuf, dstOff, srcOff, srcOff + blkStride);
        }
    }

    // Sharp 编码：raw 像素 → PNG（只调一次）
    return sharp(rawBuf, { raw: { width: imgW, height: imgH, channels: ch } })
        .png()
        .toBuffer();
}

// ==================== 解析 multipart/form-data ====================
function parseMultipart(buffer, boundary) {
    const result = { fields: {}, file: null };
    const sep = Buffer.from('--' + boundary);
    let pos = 0;
    while (pos < buffer.length) {
        const start = buffer.indexOf(sep, pos);
        if (start === -1) break;
        const nextStart = buffer.indexOf(sep, start + sep.length);
        if (nextStart === -1) break;
        const part = buffer.slice(start + sep.length, nextStart);
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd === -1) { pos = nextStart; continue; }
        const header = part.slice(0, headerEnd).toString('utf8');
        const body = part.slice(headerEnd + 4, part.length - 2);
        const nameMatch = header.match(/name="([^"]+)"/);
        const filenameMatch = header.match(/filename="([^"]+)"/);
        if (nameMatch) {
            if (filenameMatch) {
                result.file = { filename: filenameMatch[1], buffer: body };
            } else {
                result.fields[nameMatch[1]] = body.toString('utf8');
            }
        }
        pos = nextStart;
    }
    return result;
}

// ==================== Handler ====================
module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(204).end();

    if (req.method === 'GET') {
        return res.status(200).json({
            status: 'ok',
            message: '图片加密/解密 API（Vercel 云函数）',
            version: '2.1',
            usage: { method: 'POST', params: { image: '图片文件', level: '1-10', key: '密钥(可选)', mode: 'encrypt/decrypt(可选)' } }
        });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: '仅支持 POST' });
    }

    try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const bodyBuffer = Buffer.concat(chunks);
        if (bodyBuffer.length === 0) return res.status(400).json({ error: '请求体为空' });

        const ct = req.headers['content-type'] || '';
        const bm = ct.match(/boundary=(.+)/);
        if (!bm) return res.status(400).json({ error: '请用 multipart/form-data 格式' });

        const parsed = parseMultipart(bodyBuffer, bm[1]);
        if (!parsed.file) return res.status(400).json({ error: '请上传图片(image)' });

        const level = parseInt(parsed.fields.level);
        if (!level || level < 1 || level > 10) return res.status(400).json({ error: 'level 须为 1-10' });

        const key = parsed.fields.key || 'tool.hadsky.com';
        const mode = parsed.fields.mode || 'encrypt';

        const imgSizeMB = (parsed.file.buffer.length / 1024 / 1024).toFixed(1);
        console.log(`${mode} | lv${level}(${level*10}x${level*10}) | ${parsed.file.filename} (${imgSizeMB}MB)`);

        const result = await processImage(parsed.file.buffer, level, key, mode);

        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Disposition', `attachment; filename="${mode}_lv${level}.png"`);
        res.status(200).send(result);
    } catch (err) {
        console.error('处理失败:', err.message);
        res.status(500).json({ error: '处理失败: ' + err.message });
    }
};

module.exports.config = {
    api: { bodyParser: false, responseLimit: false },
    maxDuration: 60,
};
