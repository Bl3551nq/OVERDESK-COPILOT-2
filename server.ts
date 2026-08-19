import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

function getGenAI() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("GEMINI_API_KEY is not set. Using fallback mode if necessary.");
  }
  return new GoogleGenAI({
    apiKey: apiKey || '',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '25mb' }));

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // Generate Interview Response
  app.post('/api/copilot/answer', async (req, res) => {
    try {
      const {
        question,
        transcriptHistory = [],
        persona = 'coding',
        resumeText = '',
        interviewContext = '',
        sentenceLength = 'medium',
        mode = 'generate', // 'generate' | 'shorter' | 'rephrase' | 'regenerate'
        previousAnswer = '',
        modelChoice = 'gemini-3.7-flash',
      } = req.body;

      if (!question && !previousAnswer) {
        return res.status(400).json({ error: 'Question or previous answer is required' });
      }

      const ai = getGenAI();
      const targetModel = modelChoice === 'gemini-2.5-pro' ? 'gemini-2.5-pro' : 'gemini-3.7-flash';

      let personaInstruction = '';
      switch (persona) {
        case 'research':
          personaInstruction = 'You are an elite Research Scientist & Academic expert. Frame answers with systematic methodology, empirical evidence, hypothesis testing, clear trade-off analysis, and analytical depth.';
          break;
        case 'job':
          personaInstruction = 'You are an exceptional Executive & Behavioral Interview expert. Frame answers using the refined STAR method (Situation, Task, Action, Result) highlighting leadership, cross-functional collaboration, ownership, and measurable business impact.';
          break;
        case 'design':
          personaInstruction = 'You are a Principal Product & UX/UI Design leader. Frame answers around user-centric design heuristics, accessibility, system design tokens, information architecture, business metrics, and UX empathy.';
          break;
        case 'coding':
        default:
          personaInstruction = 'You are a Principal Software Engineer & Coding interview expert. Deliver sharp, technically accurate, architecture-sound answers with optimal algorithmic complexity (Time/Space O(n)), best practices, and production-ready clarity.';
          break;
      }

      let lengthInstruction = '';
      switch (sentenceLength) {
        case 'short':
          lengthInstruction = 'LENGTH: Ultra-concise (1 to 2 crisp, high-impact sentences or bullet points). Deliver immediate punchlines without filler.';
          break;
        case 'detailed':
          lengthInstruction = 'LENGTH: Comprehensive & structured (4 to 6 sentences or clear structured bullet points with technical rationale and concrete details).';
          break;
        case 'medium':
        default:
          lengthInstruction = 'LENGTH: Balanced (2 to 3 concise, conversational sentences with clear substance and momentum).';
          break;
      }

      let taskPrompt = '';
      if (mode === 'shorter') {
        taskPrompt = `Make the following interview answer significantly more concise and punchy while keeping key facts and strengths:
Previous Answer: "${previousAnswer}"`;
      } else if (mode === 'rephrase') {
        taskPrompt = `Rephrase the following interview answer to sound even more natural, confident, and engaging to speak aloud:
Previous Answer: "${previousAnswer}"`;
      } else if (mode === 'regenerate') {
        taskPrompt = `Provide an alternative compelling angle and response to this interview question:
Question: "${question}"
Previous Answer to differentiate from: "${previousAnswer}"`;
      } else {
        taskPrompt = `The interviewer just asked: "${question}"
Provide the optimal direct answer that I can speak naturally during the live interview.`;
      }

      const systemPrompt = `You are "Overdesk Copilot", a real-time live AI interview copilot assisting a job candidate during a live interview.
Your goal is to provide the exact words, key talking points, and structured narrative the candidate should say right now.

${personaInstruction}
${lengthInstruction}

${resumeText ? `CANDIDATE BACKGROUND & RESUME:
${resumeText.slice(0, 3000)}
*Important: Personalize the response to leverage the candidate's authentic experience, technologies, and achievements wherever relevant.*` : ''}

${interviewContext ? `TARGET ROLE & INTERVIEW CONTEXT:
${interviewContext}` : ''}

CRITICAL RULES:
1. Speak in FIRST PERSON ("I", "my approach", "in my experience").
2. Sound completely natural, poised, authentic, and articulate when spoken aloud.
3. No robotic phrases like "As an AI" or "Here is what you can say".
4. For technical coding questions, immediately outline the optimal approach, time/space complexity, and clean code logic.
5. Emphasize measurable impact and clear decision rationale.`;

      const response = await ai.models.generateContent({
        model: targetModel,
        contents: taskPrompt,
        config: {
          systemInstruction: systemPrompt,
          temperature: 0.7,
        },
      });

      const answer = response.text || '';
      return res.json({
        answer: answer.trim(),
        model: targetModel,
        timestamp: Date.now(),
      });
    } catch (err: any) {
      console.error('Error generating answer:', err);
      return res.status(500).json({
        error: err.message || 'Failed to generate answer',
        fallback: 'I approach this problem methodically by first isolating the core constraints and requirements, then designing a modular solution with optimal performance and clear verification.',
      });
    }
  });

  // Multimodal Screen / Coding Challenge Analyzer
  app.post('/api/copilot/analyze-screen', async (req, res) => {
    try {
      const {
        imageBase64,
        prompt = 'Solve this coding or design challenge on screen. Provide the optimal solution, clean code, time/space complexity, and a 2-sentence spoken answer to explain it to the interviewer.',
        persona = 'coding',
        interviewContext = '',
      } = req.body;

      if (!imageBase64) {
        return res.status(400).json({ error: 'Image data is required' });
      }

      const cleanBase64 = imageBase64.replace(/^data:image\/[a-z]+;base64,/, '');
      const ai = getGenAI();

      const imagePart = {
        inlineData: {
          mimeType: 'image/png',
          data: cleanBase64,
        },
      };

      const textPart = {
        text: `You are looking at the candidate's screen during an interview challenge (e.g., LeetCode, IDE, code snippet, bug, system diagram, or UI design).

Instructions:
1. Transcribe/identify the exact problem or code shown.
2. Provide a short, direct 2-3 sentence verbal explanation the candidate can say to the interviewer.
3. Provide the clean, optimal solution (with well-formatted code if applicable) and Time/Space complexity analysis.

Context: ${interviewContext || 'Technical interview'}
Persona focus: ${persona}`,
      };

      const response = await ai.models.generateContent({
        model: 'gemini-3.7-flash',
        contents: { parts: [imagePart, textPart] },
        config: {
          temperature: 0.4,
        },
      });

      return res.json({
        analysis: response.text || 'Unable to parse screen image.',
        timestamp: Date.now(),
      });
    } catch (err: any) {
      console.error('Error analyzing screen:', err);
      return res.status(500).json({
        error: err.message || 'Failed to analyze screen image',
      });
    }
  });

  // Parse Resume / Extract Profile
  app.post('/api/copilot/parse-resume', async (req, res) => {
    try {
      const { fileBase64, mimeType = 'text/plain', rawText = '' } = req.body;
      const ai = getGenAI();

      let parts: any[] = [];
      if (fileBase64 && mimeType === 'application/pdf') {
        const cleanBase64 = fileBase64.replace(/^data:application\/pdf;base64,/, '');
        parts = [
          {
            inlineData: {
              mimeType: 'application/pdf',
              data: cleanBase64,
            },
          },
          {
            text: 'Extract a concise profile summary for this candidate: Full Name/Title, Core Skills, Top 3 Projects/Achievements with key metrics, and a 3-sentence "About Me" summary suitable for tailoring live interview answers.',
          },
        ];
      } else {
        const textToAnalyze = rawText || '';
        parts = [
          {
            text: `Extract a concise profile summary for this candidate from the following text:\n\n${textToAnalyze.slice(0, 10000)}\n\nProvide:
1. Summary / About Me (3-4 sentences highlighting strengths)
2. Core Technical & Leadership Skills
3. Key Experience Highlights (Company/Role + 1-line key achievement)`,
          },
        ];
      }

      const response = await ai.models.generateContent({
        model: 'gemini-3.7-flash',
        contents: { parts },
        config: {
          temperature: 0.3,
        },
      });

      return res.json({
        summary: response.text || '',
        timestamp: Date.now(),
      });
    } catch (err: any) {
      console.error('Error parsing resume:', err);
      return res.status(500).json({
        error: err.message || 'Failed to parse resume',
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Overdesk Copilot Server running on http://localhost:${PORT}`);
  });
}

startServer();
