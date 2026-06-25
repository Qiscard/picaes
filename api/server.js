const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const DEFAULT_KEY = 'hadsky.com';

// ==================== 核心算法（与 index.html 完全一致） ====================

function getRnd(key, num) {
    let idx = num % key.length;
    idx = key.charCodeAt(idx) % key.length;
    idx = parseFloat('0.' + idx);
    return parseInt(idx * num);
}

function shuffleEncrypt(blocks, userKey) {
    // 第1步：完全颠倒顺序
    for (let i = 0; i < blocks.length / 2; i++) {
        const temp = blocks[i];
        blocks[i] = blocks[blocks.length - 1 - i];
        blocks[blocks.length - 1 - i] = temp;
    }
    // 第2步：用默认密钥伪随机打乱（从后往前）
    for (let i = blocks.length - 1; i > 0; i--) {
        const j = getRnd(DEFAULT_KEY, i + 1);
        const temp = blocks[i];
        blocks[i] = blocks[j];
        blocks[j] = temp;
    }
    // 第3步：用用户密钥伪随机打乱（从后往前）
    if (userKey) {
        for (let i = blocks.length - 1; i > 0; i--) {
            const j = getRnd(userKey, i + 1);
            const temp = blocks[i];
            blocks[i] = blocks[j];
            blocks[j] = temp;
        }
    }
    return blocks;
}

function shuffleDecrypt(blocks, userKey) {
    // 第1步：用用户密钥反向还原（从前往后）
    if (userKey) {
        for (let i = 0; i < blocks.length; i++) {
            const j = getRnd(userKey, i + 1);
            const temp = blocks[j];
            blocks[j] = blocks[i];
            blocks[i] = temp;
        }
    }
    // 第2步：用默认密钥反向还原（从前往后）
    for (let i = 0; i < blocks.length; i++) {
        const j = getRnd(DEFAULT_KEY, i + 1);
        const temp = blocks[j];
        blocks[j] = blocks[i];
        blocks[i] = temp;
    }
    // 第3步：再次完全颠倒顺序
    for (let i = 0; i < blocks.length / 2; i++) {
        const temp = blocks[i];
        blocks[i] = blocks[blocks.length - 1 - i];
        blocks[blocks.length - 1 - i] = temp;
    }
    return blocks;
}

// ==================== 图片处理 ====================

async function processImage(imageBuffer, level, key, mode) {
    // level: 1-10, 对应网格 N = level * 10
    // 但根据原HTML逻辑，level值本身就是网格数（10,20,30...100）
    const N = level; // 网格 N×N
    const gridSize = N * N;

    // 读取图片元信息
    const metadata = await sharp(imageBuffer).metadata();
    const imgW = metadata.width;
    const imgH = metadata.height;

    // 计算每块大小（整除，丢弃边缘像素以保持一致）
    const blockW = Math.floor(imgW / N);
    const blockH = Math.floor(imgH / N);

    if (blockW < 1 || blockH < 1) {
        throw new Error(`图片尺寸 ${imgW}×${imgH} 对于等级 ${N/10}（${N}×${N} 网格）太小，每块至少需要 1×1 像素`);
    }

    // 获取原始 RGBA 像素数据
    const rawImage = await sharp(imageBuffer)
        .resize(blockW * N, blockH * N, { fit: 'fill' })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const rawData = rawImage.data;
    const channels = 4; // RGBA
    const realW = blockW * N;
    const realH = blockH * N;

    // 切割成方块
    const blocks = [];
    for (let row = 0; row < N; row++) {
        for (let col = 0; col < N; col++) {
            const blockPixels = Buffer.alloc(blockW * blockH * channels);
            for (let y = 0; y < blockH; y++) {
                const srcOffset = ((row * blockH + y) * realW + col * blockW) * channels;
                const dstOffset = y * blockW * channels;
                rawData.copy(blockPixels, dstOffset, srcOffset, srcOffset + blockW * channels);
            }
            blocks.push(blockPixels);
        }
    }

    // 执行加密或解密
    if (mode === 'encrypt') {
        shuffleEncrypt(blocks, key);
    } else {
        shuffleDecrypt(blocks, key);
    }

    // 重新拼装
    const resultBuffer = Buffer.alloc(realW * realH * channels);
    blocks.forEach((blockPixels, index) => {
        const row = Math.floor(index / N);
        const col = index % N;
        for (let y = 0; y < blockH; y++) {
            const srcOffset = y * blockW * channels;
            const dstOffset = ((row * blockH + y) * realW + col * blockW) * channels;
            blockPixels.copy(resultBuffer, dstOffset, srcOffset, srcOffset + blockW * channels);
        }
    });

    // 输出为 PNG
    return sharp(resultBuffer, {
        raw: { width: realW, height: realH, channels: channels }
    }).png().toBuffer();
}

// ==================== API 路由 ====================

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: '图片加密/解密 API 服务运行中' });
});

// API 文档页面
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="zh">
<head>
    <meta charset="utf-8">
    <title>图片加密/解密 API</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f0f2f5; color: #333; line-height: 1.6; }
        .container { max-width: 900px; margin: 0 auto; padding: 20px; }
        h1 { text-align: center; margin: 30px 0; color: #1a1a2e; font-size: 28px; }
        .card { background: #fff; border-radius: 12px; padding: 24px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
        .card h2 { color: #16213e; margin-bottom: 16px; font-size: 18px; border-left: 4px solid #4361ee; padding-left: 12px; }
        .endpoint { background: #f8f9fa; border-radius: 8px; padding: 16px; margin: 12px 0; border-left: 4px solid #4361ee; }
        .method { display: inline-block; background: #4361ee; color: #fff; padding: 2px 10px; border-radius: 4px; font-weight: bold; font-size: 13px; margin-right: 8px; }
        .url { font-family: monospace; font-size: 15px; color: #333; }
        table { width: 100%; border-collapse: collapse; margin: 12px 0; }
        th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid #eee; }
        th { background: #f8f9fa; font-weight: 600; color: #555; }
        code { background: #e8edf5; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
        pre { background: #1a1a2e; color: #a8e6cf; padding: 16px; border-radius: 8px; overflow-x: auto; font-size: 13px; margin: 12px 0; }
        .try-section { margin-top: 20px; }
        .try-section input, .try-section select { padding: 8px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; margin: 4px; }
        .try-section button { padding: 10px 24px; background: #4361ee; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; margin: 4px; }
        .try-section button:hover { background: #3a56d4; }
        .try-section button.decrypt { background: #e74c3c; }
        .try-section button.decrypt:hover { background: #c0392b; }
        #result { margin-top: 16px; }
        #result img { max-width: 100%; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        .info { background: #e8f4f8; border-radius: 8px; padding: 12px 16px; margin: 12px 0; font-size: 14px; color: #0c5460; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔒 图片加密/解密 API</h1>

        <div class="card">
            <h2>接口说明</h2>
            <div class="endpoint">
                <span class="method">POST</span>
                <span class="url">/api/process</span>
            </div>
            <p style="margin-top:12px; color:#666;">上传图片，指定加密/解密等级和密钥，返回处理后的图片。</p>
        </div>

        <div class="card">
            <h2>请求参数</h2>
            <table>
                <tr><th>参数</th><th>类型</th><th>必填</th><th>说明</th></tr>
                <tr><td><code>image</code></td><td>File</td><td>✅</td><td>图片文件（multipart/form-data）</td></tr>
                <tr><td><code>level</code></td><td>Number</td><td>✅</td><td>加密等级 1-10（数字越大越复杂）</td></tr>
                <tr><td><code>key</code></td><td>String</td><td>❌</td><td>密钥，默认 "tool.hadsky.com"</td></tr>
                <tr><td><code>mode</code></td><td>String</td><td>❌</td><td>模式：encrypt（加密，默认）/ decrypt（解密）</td></tr>
            </table>
            <div class="info">
                💡 等级说明：1级=10×10=100块，4级=40×40=1600块，10级=100×100=10000块。等级越高，打乱越复杂。
            </div>
        </div>

        <div class="card">
            <h2>调用示例</h2>
            <p><strong>cURL：</strong></p>
            <pre>curl -X POST http://你的服务器IP:8383/api/process \\
  -F "image=@photo.png" \\
  -F "level=4" \\
  -F "key=mysecretkey" \\
  -F "mode=encrypt" \\
  -o encrypted.png</pre>
            <p style="margin-top:12px;"><strong>JavaScript (fetch)：</strong></p>
            <pre>const formData = new FormData();
formData.append('image', fileInput.files[0]);
formData.append('level', '4');
formData.append('key', 'mysecretkey');
formData.append('mode', 'encrypt');

const res = await fetch('http://你的服务器IP:8383/api/process', {
    method: 'POST',
    body: formData
});
const blob = await res.blob();</pre>
            <p style="margin-top:12px;"><strong>Python：</strong></p>
            <pre>import requests

resp = requests.post('http://你的服务器IP:8383/api/process',
    files={'image': open('photo.png', 'rb')},
    data={'level': 4, 'key': 'mysecretkey', 'mode': 'encrypt'}
)
with open('encrypted.png', 'wb') as f:
    f.write(resp.content)</pre>
        </div>

        <div class="card">
            <h2>在线测试</h2>
            <div class="try-section">
                <input type="file" id="fileInput" accept="image/*"><br>
                <select id="level">
                    <option value="1">1级 (10×10)</option>
                    <option value="2">2级 (20×20)</option>
                    <option value="3">3级 (30×30)</option>
                    <option value="4" selected>4级 (40×40)</option>
                    <option value="5">5级 (50×50)</option>
                    <option value="8">8级 (80×80)</option>
                    <option value="10">10级 (100×100)</option>
                </select>
                <input type="text" id="key" placeholder="密钥" value="tool.hadsky.com" style="width:200px">
                <button onclick="doProcess('encrypt')">🔒 加密</button>
                <button class="decrypt" onclick="doProcess('decrypt')">🔓 解密</button>
                <div id="result"></div>
            </div>
        </div>
    </div>
    <script>
    async function doProcess(mode) {
        const fileInput = document.getElementById('fileInput');
        if (!fileInput.files[0]) { alert('请先选择图片'); return; }
        const formData = new FormData();
        formData.append('image', fileInput.files[0]);
        formData.append('level', document.getElementById('level').value);
        formData.append('key', document.getElementById('key').value);
        formData.append('mode', mode);
        const resultDiv = document.getElementById('result');
        resultDiv.innerHTML = '<p>处理中...</p>';
        try {
            const res = await fetch('/api/process', { method: 'POST', body: formData });
            if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            resultDiv.innerHTML = '<p>处理完成 ✅</p><img src="' + url + '"><br><a href="' + url + '" download="result.png">下载结果</a>';
        } catch(e) { resultDiv.innerHTML = '<p style="color:red">错误: ' + e.message + '</p>'; }
    }
    </script>
</body>
</html>`);
});

// 核心处理接口
app.post('/api/process', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: '请上传图片文件（字段名: image）' });
        }

        const level = parseInt(req.body.level);
        if (!level || level < 1 || level > 10) {
            return res.status(400).json({ error: 'level 必须是 1-10 的整数' });
        }

        const key = req.body.key || 'tool.hadsky.com';
        const mode = req.body.mode || 'encrypt';

        if (!['encrypt', 'decrypt'].includes(mode)) {
            return res.status(400).json({ error: 'mode 必须是 encrypt 或 decrypt' });
        }

        const N = level * 10; // 等级 1→10×10, 4→40×40, 10→100×100
        console.log(`[${new Date().toISOString()}] ${mode} | 等级:${level}(${N}×${N}) | 密钥:${key} | 文件:${req.file.originalname} (${(req.file.size/1024).toFixed(1)}KB)`);

        const result = await processImage(req.file.buffer, N, key, mode);

        res.set({
            'Content-Type': 'image/png',
            'Content-Disposition': `attachment; filename="${mode}_${level}_${Date.now()}.png"`
        });
        res.send(result);

    } catch (err) {
        console.error('处理失败:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// 启动服务
const PORT = 18383;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`图片加密/解密 API 已启动: http://0.0.0.0:${PORT}`);
    console.log(`接口地址: POST http://localhost:${PORT}/api/process`);
    console.log(`文档页面: http://localhost:${PORT}/`);
});
