// Vercel Serverless Function - 图片加密/解密（纯 Vercel，无需外部服务器）
// 文件路径: api/process.js
import sharp from 'sharp';

// ==================== 混淆算法（与客户端一致）====================
const DEFAULT_KEY = 'hadsky.com';

function getRnd(key, num) {
    let idx = num % key.length;
    idx = key.charCodeAt(idx) % key.length;
    idx = parseFloat('0.' + idx);
    return parseInt(idx * num);
}

function shuffleEncrypt(blocks, userKey) {
    // 第1步：完全颠倒顺序
    blocks.reverse();
    // 第2步：用默认密钥打乱（从后往前）
    for (let i = blocks.length - 1; i > 0; i--) {
        const j = getRnd(DEFAULT_KEY, i + 1);
        [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
    }
    // 第3步：用用户密钥打乱（从后往前）
    if (userKey) {
        for (let i = blocks.length - 1; i > 0; i--) {
            const j = getRnd(userKey, i + 1);
            [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
        }
    }
    return blocks;
}

function shuffleDecrypt(blocks, userKey) {
    // 第1步：用用户密钥反向还原
    if (userKey) {
        for (let i = 0; i < blocks.length; i++) {
            const j = getRnd(userKey, i + 1);
            [blocks[j], blocks[i]] = [blocks[i], blocks[j]];
        }
    }
    // 第2步：用默认密钥反向还原
    for (let i = 0; i < blocks.length; i++) {
        const j = getRnd(DEFAULT_KEY, i + 1);
        [blocks[j], blocks[i]] = [blocks[i], blocks[j]];
    }
    // 第3步：再次颠倒
    blocks.reverse();
    return blocks;
}

// ==================== 图片处理核心 ====================
async function processImage(imageBuffer, level, key, mode) {
    const N = level * 10; // 等级 4 → 40×40 = 1600 块
    const image = sharp(imageBuffer);
    const meta = await image.metadata();
    const imgW = meta.width;
    const imgH = meta.height;

    const blockW = Math.floor(imgW / N);
    const blockH = Math.floor(imgH / N);

    // 提取所有方块
    const extractOps = [];
    for (let row = 0; row < N; row++) {
        for (let col = 0; col < N; col++) {
            extractOps.push(
                image.clone()
                    .extract({
                        left: col * blockW,
                        top: row * blockH,
                        width: blockW,
                        height: blockH,
                    })
                    .raw()
                    .toBuffer()
            );
        }
    }
    const blocks = await Promise.all(extractOps);

    // 混淆/解混淆
    if (mode === 'encrypt') {
        shuffleEncrypt(blocks, key);
    } else {
        shuffleDecrypt(blocks, key);
    }

    // 把方块拼回图片
    // 先创建底图画布
    const channels = meta.channels || 3;
    const bg = channels === 4
        ? { r: 0, g: 0, b: 0, alpha: 1 }
        : { r: 0, g: 0, b: 0 };
    const canvas = sharp({
        create: {
            width: imgW,
            height: imgH,
            channels: channels,
            background: bg,
        },
    }).raw();

    const canvasBuf = await canvas.toBuffer();

    // 逐块写入画布
    for (let i = 0; i < blocks.length; i++) {
        const row = Math.floor(i / N);
        const col = i % N;
        const blockBuf = blocks[i];
        const bytesPerPixel = channels;

        for (let y = 0; y < blockH; y++) {
            const srcOffset = y * blockW * bytesPerPixel;
            const dstOffset = ((row * blockH + y) * imgW + col * blockW) * bytesPerPixel;
            const sliceLen = blockW * bytesPerPixel;
            blockBuf.copy(canvasBuf, dstOffset, srcOffset, srcOffset + sliceLen);
        }
    }

    return sharp(canvasBuf, {
        raw: { width: imgW, height: imgH, channels: channels },
    }).png().toBuffer();
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
        const body = part.slice(headerEnd + 4, part.length - 2); // 去掉末尾 \r\n

        const nameMatch = header.match(/name="([^"]+)"/);
        const filenameMatch = header.match(/filename="([^"]+)"/);
        const ctMatch = header.match(/Content-Type:\s*(.+)/i);

        if (nameMatch) {
            if (filenameMatch) {
                result.file = {
                    fieldname: nameMatch[1],
                    filename: filenameMatch[1],
                    contentType: ctMatch ? ctMatch[1].trim() : 'application/octet-stream',
                    buffer: body,
                };
            } else {
                result.fields[nameMatch[1]] = body.toString('utf8');
            }
        }
        pos = nextStart;
    }
    return result;
}

// ==================== Vercel Handler ====================
export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(204).end();

    // GET - 状态检查
    if (req.method === 'GET') {
        return res.status(200).json({
            status: 'ok',
            message: '图片加密/解密 API（Vercel 原生）',
            version: '2.0',
            usage: {
                method: 'POST',
                content_type: 'multipart/form-data',
                params: {
                    image: '图片文件（必填）',
                    level: '加密等级 1-10（必填）',
                    key: '密钥（可选，默认 tool.hadsky.com）',
                    mode: 'encrypt 或 decrypt（可选，默认 encrypt）'
                }
            }
        });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: '仅支持 POST 请求' });
    }

    try {
        // 读取请求体
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const bodyBuffer = Buffer.concat(chunks);

        if (bodyBuffer.length === 0) {
            return res.status(400).json({ error: '请求体为空，请上传图片' });
        }

        // 解析 multipart
        const ct = req.headers['content-type'] || '';
        const boundaryMatch = ct.match(/boundary=(.+)/);
        if (!boundaryMatch) {
            return res.status(400).json({ error: '请使用 multipart/form-data 格式' });
        }

        const parsed = parseMultipart(bodyBuffer, boundaryMatch[1]);

        if (!parsed.file) {
            return res.status(400).json({ error: '请上传图片文件（字段名: image）' });
        }

        const level = parseInt(parsed.fields.level);
        if (!level || level < 1 || level > 10) {
            return res.status(400).json({ error: 'level 必须是 1-10 的整数' });
        }

        const key = parsed.fields.key || 'tool.hadsky.com';
        const mode = parsed.fields.mode || 'encrypt';

        if (!['encrypt', 'decrypt'].includes(mode)) {
            return res.status(400).json({ error: 'mode 必须是 encrypt 或 decrypt' });
        }

        console.log(`${mode} | level:${level}(${level * 10}x${level * 10}) | key:${key} | file:${parsed.file.filename} (${(parsed.file.buffer.length / 1024).toFixed(1)}KB)`);

        const result = await processImage(parsed.file.buffer, level, key, mode);

        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Disposition', `attachment; filename="${mode}_lv${level}.png"`);
        res.status(200).send(result);

    } catch (err) {
        console.error('处理失败:', err.message, err.stack);
        res.status(500).json({ error: '图片处理失败: ' + err.message });
    }
}

export const config = {
    api: {
        bodyParser: false,
        responseLimit: false,
    },
    maxDuration: 60,
};
