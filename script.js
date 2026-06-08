
// DOM elements
const video = document.getElementById('cameraFeed');
const scanPage1Btn = document.getElementById('scanPage1Btn');
const scanPage2Btn = document.getElementById('scanPage2Btn');
const submitBtn = document.getElementById('submitBtn');
const statusDiv = document.getElementById('status');
const qualityDiv = document.getElementById('qualityFeedback');

let stream = null;
let page1Image = null;
let page2Image = null;

// ---------- Camera Setup ----------
async function setupCamera() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        video.srcObject = stream;
        await video.play();
        statusDiv.innerHTML = "✅ Camera ready. Position your exam page in frame.";
    } catch (err) {
        statusDiv.innerHTML = "❌ Camera access denied or error: " + err.message;
        console.error(err);
    }
}

// ---------- Quality Check Function ----------
// Returns { isGood: bool, reason: string }
function checkImageQuality(imageDataUrl) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0, img.width, img.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            
            // 1. Sharpness check using Laplacian variance
            const laplacian = computeLaplacianVariance(imageData);
            const isSharp = laplacian > 50; // threshold – adjust if needed
            
            // 2. Brightness check (average luminance)
            let totalLuminance = 0;
            for (let i = 0; i < imageData.data.length; i += 4) {
                const r = imageData.data[i];
                const g = imageData.data[i+1];
                const b = imageData.data[i+2];
                const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                totalLuminance += luminance;
            }
            const avgLuminance = totalLuminance / (imageData.width * imageData.height);
            const isBrightEnough = avgLuminance > 80;
            
            let reason = "";
            let isGood = true;
            if (!isSharp) {
                isGood = false;
                reason += "❌ Blurry image. Hold steady and ensure good lighting. ";
            }
            if (!isBrightEnough) {
                isGood = false;
                reason += "❌ Too dark. Add more light. ";
            }
            if (isGood) reason = "✅ Good quality! Sharp and well-lit.";
            resolve({ isGood, reason });
        };
        img.src = imageDataUrl;
    });
}

// Helper: Laplacian variance (sharpness)
function computeLaplacianVariance(imageData) {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
    let sum = 0, sumSq = 0;
    // Simple 3x3 Laplacian kernel
    const kernel = [0, -1, 0, -1, 4, -1, 0, -1, 0];
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            let idx = (y * width + x) * 4;
            let r = data[idx];
            let g = data[idx+1];
            let b = data[idx+2];
            let gray = 0.299 * r + 0.587 * g + 0.114 * b;
            
            let lap = 0;
            for (let ky = -1; ky <= 1; ky++) {
                for (let kx = -1; kx <= 1; kx++) {
                    let kIdx = (ky+1)*3 + (kx+1);
                    let pixelIdx = ((y+ky)*width + (x+kx)) * 4;
                    let pr = data[pixelIdx];
                    let pg = data[pixelIdx+1];
                    let pb = data[pixelIdx+2];
                    let pgray = 0.299 * pr + 0.587 * pg + 0.114 * pb;
                    lap += kernel[kIdx] * pgray;
                }
            }
            sum += lap;
            sumSq += lap * lap;
        }
    }
    const variance = (sumSq / (width*height)) - Math.pow(sum/(width*height), 2);
    return variance;
}

// ---------- Capture a single page from video feed ----------
async function capturePage(pageNumber) {
    statusDiv.innerHTML = `📷 Capturing Page ${pageNumber}... checking quality...`;
    
    // Draw current video frame to a temporary canvas
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = video.videoWidth;
    tempCanvas.height = video.videoHeight;
    const ctx = tempCanvas.getContext('2d');
    ctx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);
    const imageDataUrl = tempCanvas.toDataURL('image/jpeg', 0.9);
    
    // Quality check
    const quality = await checkImageQuality(imageDataUrl);
    qualityDiv.innerHTML = quality.reason;
    qualityDiv.className = quality.isGood ? "quality-feedback quality-good" : "quality-feedback quality-bad";
    
    if (!quality.isGood) {
        statusDiv.innerHTML = `⚠️ Page ${pageNumber} rejected. ${quality.reason} Try again.`;
        return false;
    }
    
    // Store image
    if (pageNumber === 1) {
        page1Image = imageDataUrl;
        scanPage1Btn.disabled = true;
        scanPage2Btn.disabled = false;
        statusDiv.innerHTML = "✅ Page 1 captured successfully! Now scan Page 2.";
    } else {
        page2Image = imageDataUrl;
        scanPage2Btn.disabled = true;
        submitBtn.disabled = false;
        statusDiv.innerHTML = "✅ Page 2 captured! Click 'Send to Gemini AI' to extract questions & answers.";
    }
    return true;
}

// ---------- Send to Gemini via Vercel serverless function ----------
async function sendToGemini() {
    if (!page1Image || !page2Image) {
        statusDiv.innerHTML = "❌ Both pages must be captured first.";
        return;
    }
    
    submitBtn.disabled = true;
    submitBtn.innerText = "⏳ Processing...";
    statusDiv.innerHTML = "🤖 Sending pages to Gemini AI...";
    
    try {
        const response = await fetch('/api/gemini', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                page1: page1Image,
                page2: page2Image
            })
        });
        
        const data = await response.json();
        if (response.ok) {
            const resultDiv = document.getElementById('result');
            resultDiv.innerHTML = `<strong>📝 Extracted Q&A:</strong><br><br>${data.extractedText.replace(/\n/g, '<br>')}`;
            statusDiv.innerHTML = "✨ Done! Answers extracted.";
        } else {
            statusDiv.innerHTML = `❌ Error: ${data.error || 'Unknown error'}`;
        }
    } catch (err) {
        statusDiv.innerHTML = `❌ Network error: ${err.message}`;
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = "✨ Send to Gemini AI";
    }
}

// ---------- Event listeners ----------
scanPage1Btn.onclick = () => capturePage(1);
scanPage2Btn.onclick = () => capturePage(2);
submitBtn.onclick = sendToGemini;

// Start camera on load
setupCamera();

// Optional: clean up on page unload
window.addEventListener('beforeunload', () => {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }
});
