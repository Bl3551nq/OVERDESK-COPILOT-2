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

  // CORS middleware for cross-origin Electron & web requests
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  app.use(express.json({ limit: '25mb' }));

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // Generate Interview Response
  app.post('/api/copilot/answer', async (req, res) => {
    const {
      question = '',
      transcriptHistory = [],
      persona = 'coding',
      resumeText = '',
      interviewContext = '',
      sentenceLength = 'medium',
      mode = 'generate', // 'generate' | 'shorter' | 'rephrase' | 'regenerate'
      previousAnswer = '',
      modelChoice = 'gemini-3.7-flash',
    } = req.body || {};

    if (!question && !previousAnswer) {
      return res.status(400).json({ error: 'Question or previous answer is required' });
    }

    try {
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
      console.error('Error generating answer with Gemini API:', err?.message || err);

      // Smart programmatic fallback if API key is missing, rate-limited, or network fails
      let smartFallback = '';
      const base = previousAnswer || question || 'I approach this methodically by breaking down constraints and delivering high-quality, measurable results.';

      if (mode === 'shorter') {
        const sentences = base.split(/(?<=[.?!])\s+/).filter(Boolean);
        if (sentences.length > 1) {
          smartFallback = sentences.slice(0, Math.max(1, Math.min(2, Math.ceil(sentences.length / 2)))).join(' ');
        } else {
          smartFallback = base.replace(/^(First off,|To begin with,|In order to solve this,|Basically,)\s*/i, '');
        }
      } else if (mode === 'rephrase') {
        if (base.toLowerCase().includes('in my experience') || base.toLowerCase().includes('i approach')) {
          smartFallback = `At my previous role, I tackled this by establishing clear architectural boundaries, decoupling core workflows, and driving measurable performance optimizations.`;
        } else {
          smartFallback = `In my experience, the optimal approach begins with clarifying non-negotiables, selecting resilient data structures, and delivering clean, maintainable code with comprehensive test coverage.`;
        }
      } else if (mode === 'regenerate') {
        if (persona === 'job') {
          smartFallback = `In a previous high-stakes situation, I took ownership by rallying cross-functional stakeholders, aligning our milestones around core business impact, and delivering the objective 2 weeks ahead of schedule.`;
        } else if (persona === 'design') {
          smartFallback = `I start from user empathy and journey mapping, validating assumptions through rapid wireframes and accessible design tokens before scaling the component library.`;
        } else {
          smartFallback = `I solve this by leveraging an optimal hash-map frequency counter or two-pointer approach, bringing the algorithmic complexity down to O(N) time and O(1) auxiliary space.`;
        }
      } else {
        smartFallback = `I approach this by isolating the core technical constraints, establishing modular invariants, and verifying edge cases through deterministic testing.`;
      }

      return res.json({
        answer: smartFallback,
        model: 'gemini-fallback',
        isFallback: true,
        timestamp: Date.now(),
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
    const { fileBase64, mimeType = 'text/plain', rawText = '' } = req.body || {};

    try {
      const ai = getGenAI();

      let parts: any[] = [];
      if (fileBase64) {
        const cleanBase64 = fileBase64.replace(/^data:[^;]+;base64,/, '').trim();
        const effectiveMime = mimeType === 'application/pdf' ? 'application/pdf' : 'text/plain';

        if (effectiveMime === 'application/pdf') {
          parts = [
            {
              inlineData: {
                mimeType: 'application/pdf',
                data: cleanBase64,
              },
            },
            {
              text: 'Extract a concise candidate profile for live interview answers: 1) Full Name/Role, 2) Core Technical & Leadership Skills, 3) 2-3 Key Impact Achievements with metrics, and 4) A 2-sentence conversational summary the candidate can use to introduce themselves.',
            },
          ];
        } else {
          // Plain text from file
          const decodedText = Buffer.from(cleanBase64, 'base64').toString('utf-8');
          parts = [
            {
              text: `Extract a concise profile summary for this candidate from the resume text:\n\n${decodedText.slice(0, 10000)}\n\nProvide: Core Skills, Key Experience Highlights, and a 2-sentence conversational overview.`,
            },
          ];
        }
      } else {
        const textToAnalyze = rawText || '';
        parts = [
          {
            text: `Extract a concise candidate profile summary from the following text:\n\n${textToAnalyze.slice(0, 10000)}\n\nProvide: Core Skills, Key Experience Highlights, and a 2-sentence conversational overview.`,
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
        summary: response.text || 'Candidate profile extracted successfully.',
        timestamp: Date.now(),
      });
    } catch (err: any) {
      console.error('Error parsing resume with Gemini:', err?.message || err);

      // Smart fallback summary if external API fails
      let fallbackSummary = 'Senior Software Engineer with extensive experience in scalable cloud services, full-stack architecture, and leading cross-functional engineering teams.';
      if (rawText && rawText.length > 20) {
        fallbackSummary = `Candidate Experience: ${rawText.slice(0, 400).replace(/[\r\n]+/g, ' ')}...`;
      }

      return res.json({
        summary: fallbackSummary,
        isFallback: true,
        timestamp: Date.now(),
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
