
// api/gemini.js
export default async function handler(req, res) {
    // Only allow POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { page1, page2 } = req.body;
    if (!page1 || !page2) {
        return res.status(400).json({ error: 'Both page images are required' });
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
        return res.status(500).json({ error: 'Missing Gemini API key' });
    }

    // Prepare images for Gemini (strip the base64 header)
    const base64Page1 = page1.split(',')[1];
    const base64Page2 = page2.split(',')[1];

    // The prompt that forces only Q&A extraction
    const prompt = `
You are an AI assistant specialized in extracting exam content.
Look at the two exam page images provided. 
Extract **only the questions and their corresponding answers** from these pages.
- Ignore any headers, footers, page numbers, instructions like "Please answer all questions" or "Total marks".
- Ignore any teacher's notes or extraneous text.
- If a question has multiple parts (a, b, c), include them.
- Output in a clean, readable format, e.g.:
    Question 1: [text of question]
    Answer 1: [text of answer]
    Question 2: ...
- Do not include any additional commentary or explanations.
    `;

    // Gemini API request structure for multiple images
    const requestBody = {
        contents: [
            {
                parts: [
                    { text: prompt },
                    { inline_data: { mime_type: "image/jpeg", data: base64Page1 } },
                    { inline_data: { mime_type: "image/jpeg", data: base64Page2 } }
                ]
            }
        ],
        generationConfig: {
            temperature: 0.2,   // lower = more deterministic
            maxOutputTokens: 2048
        }
    };

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            }
        );

        const data = await response.json();
        if (!response.ok) {
            console.error('Gemini API error:', data);
            return res.status(500).json({ error: 'Gemini API error: ' + (data.error?.message || 'Unknown') });
        }

        const extractedText = data.candidates[0].content.parts[0].text;
        return res.status(200).json({ extractedText });
    } catch (error) {
        console.error('Server error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
