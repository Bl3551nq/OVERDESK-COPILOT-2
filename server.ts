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
${resumeText.slice(0, 15000)}
*Important: Personalize the response to directly incorporate the candidate's authentic career projects, technologies, and metrics.*` : ''}

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

  // Multimodal Screen / Universal Challenge & Problem Analyzer
  app.post('/api/copilot/analyze-screen', async (req, res) => {
    try {
      const {
        imageBase64,
        prompt: userPrompt = '',
        persona = 'coding',
        challengeType = 'auto',
        interviewContext = '',
      } = req.body;

      if (!imageBase64) {
        return res.status(400).json({ error: 'Image data is required' });
      }

      // Robust Data URL parsing for png, jpeg, webp, gif, bmp
      let effectiveMime = 'image/jpeg';
      const mimeMatch = imageBase64.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/);
      if (mimeMatch && mimeMatch[1]) {
        effectiveMime = mimeMatch[1];
      }

      const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '').trim();
      const ai = getGenAI();

      const imagePart = {
        inlineData: {
          mimeType: effectiveMime,
          data: cleanBase64,
        },
      };

      const systemDirective = `You are an expert real-time AI interview assistant analyzing a candidate's screen capture during a live interview or assessment.
The image on screen may contain ANY of the following:
1. Coding / Algorithms (e.g. LeetCode, HackerRank, CodeSignal, IDE, Terminal, VS Code, debugging, SQL queries, database schemas).
2. System Design & Architecture (e.g. architecture diagrams, AWS/GCP cloud topology, distributed system block diagrams, microservices flow, ER diagrams).
3. UI/UX & Frontend Design (e.g. Figma mockups, CSS/HTML layouts, wireframes, user flow diagrams, component hierarchies).
4. Data Science, Math & ML (e.g. formulas, graphs, statistics questions, Python data pipelines, machine learning model architectures).
5. Behavioral, Case Study or Multiple-Choice Assessment (e.g. McKinsey/consulting case slides, online assessment test questions, situational judgment scenarios).

YOUR TASK:
Carefully inspect the screenshot image. Identify the EXACT question, challenge, diagram, or problem presented in THIS SPECIFIC IMAGE.

Provide your output strictly structured with these clear sections:

### 1. Problem / Question Identified
- **Title / Summary:** [State the specific problem name or question asked]
- **Key Constraints & Requirements:** [List the exact inputs, outputs, constraints, or goals shown in the image]

### 2. Spoken Talking Points (What to say out loud right now)
"[Provide 2-3 natural, articulate first-person sentences the candidate can immediately say to the interviewer to explain their line of thinking, assumptions, and proposed solution.]"

### 3. Step-by-Step Solution & Implementation
- If Coding/Algorithmic: Provide the clean, production-ready code implementation (in the language indicated on screen or TypeScript/Python by default) with helpful comments, followed by **Time Complexity: O(...)** and **Space Complexity: O(...)**.
- If System Design: Provide the structured architectural breakdown (Core Components, Data Storage, Ingestion/Read APIs, Scalability & Bottleneck Mitigations, Trade-offs).
- If UI/UX/Product Design: Provide the design rationale, component hierarchy, accessibility/UX considerations, and responsive layout approach.
- If Multiple Choice / Test Question: State the **Correct Answer** clearly with concise justification.
- If Case Study / Business Analysis: Provide the structured framework, root cause analysis, and quantitative/strategic recommendation.

Context from candidate: ${interviewContext || 'Job Interview'}
Candidate Persona: ${persona}
${userPrompt ? `Specific candidate instruction: ${userPrompt}` : ''}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.7-flash',
        contents: {
          parts: [
            imagePart,
            { text: systemDirective }
          ]
        },
        config: {
          temperature: 0.2,
        },
      });

      const analysisText = response.text || '';
      if (!analysisText.trim()) {
        throw new Error('Empty response from vision model');
      }

      return res.json({
        analysis: analysisText.trim(),
        timestamp: Date.now(),
      });
    } catch (err: any) {
      console.error('Error analyzing screen with Gemini Vision:', err?.message || err);

      return res.status(500).json({
        error: err?.message || 'Could not analyze screenshot with Vision model',
        timestamp: Date.now(),
      });
    }
  });

  // Parse Resume / Extract Full Profile (PDF, Images/Photos, Documents & Text)
  app.post('/api/copilot/parse-resume', async (req, res) => {
    const { fileBase64, mimeType = 'text/plain', rawText = '' } = req.body || {};

    try {
      const ai = getGenAI();

      let parts: any[] = [];
      const resumeAnalysisPrompt = `You are an expert technical recruiter and executive interview coach. 
Analyze this complete resume (whether provided as a document, PDF, photo/screenshot, or text). 
Extract the candidate's COMPLETE, DETAILED profile in full without omitting any jobs, metrics, or technologies. 

Format the output cleanly in rich Markdown with the following comprehensive sections:

## 👤 CANDIDATE PROFILE
- **Name & Title:** [Full Name and Target / Current Role]
- **Experience Level:** [Years of experience & core domain expertise]
- **Core Elevator Pitch:** [A strong 3-4 sentence professional introduction the candidate can use in interviews]

## 🛠️ COMPLETE SKILLS & TECH STACK
- **Languages & Frameworks:** [List all mentioned languages and frameworks]
- **Cloud, DevOps & Infrastructure:** [AWS, GCP, Azure, Docker, Kubernetes, CI/CD, etc.]
- **Databases & Architecture:** [SQL, NoSQL, Caching, Microservices, System Design patterns]
- **Methodologies & Leadership:** [Agile, Sprint planning, Mentorship, Cross-functional collaboration]

## 💼 CAREER HISTORY & KEY ACHIEVEMENTS (DETAILED)
[List EVERY company, position, and timeframe from the resume. For each role, include]:
- **Role & Company:** [Title at Company | Timeframe]
- **Key Responsibilities & Scope:** [What they built or managed]
- **Quantifiable Impact & Metrics:** [List every metric, percentage, revenue number, performance speedup, scale milestone, or team accomplishment mentioned]

## 🚀 NOTABLE PROJECTS & SYSTEMS
[List major projects, systems designed, or open-source initiatives with their architecture and tech stack]

## 🎓 EDUCATION & CERTIFICATIONS
- [Degrees, Universities, Honors, and Professional Certifications]

## 💡 STAR INTERVIEW TALKING POINTS
- **Greatest Technical Win:** [Specific story from their resume to mention in technical rounds]
- **Leadership / Scaling Win:** [Specific story for behavioral/manager rounds]

Extract everything thoroughly and accurately so the candidate has their full context ready for real-time interview answers.`;

      if (fileBase64) {
        const cleanBase64 = fileBase64.replace(/^data:[^;]+;base64,/, '').trim();
        const lowerMime = (mimeType || '').toLowerCase();

        if (lowerMime.includes('pdf')) {
          parts = [
            {
              inlineData: {
                mimeType: 'application/pdf',
                data: cleanBase64,
              },
            },
            { text: resumeAnalysisPrompt },
          ];
        } else if (
          lowerMime.includes('image') ||
          lowerMime.includes('png') ||
          lowerMime.includes('jpg') ||
          lowerMime.includes('jpeg') ||
          lowerMime.includes('webp')
        ) {
          const imageMime = lowerMime.includes('png') ? 'image/png' : 'image/jpeg';
          parts = [
            {
              inlineData: {
                mimeType: imageMime,
                data: cleanBase64,
              },
            },
            { text: `This is a pictorial/screenshot resume. Read all text, tables, and sections thoroughly.\n\n${resumeAnalysisPrompt}` },
          ];
        } else {
          // Plain text or Markdown file
          let decodedText = '';
          try {
            decodedText = Buffer.from(cleanBase64, 'base64').toString('utf-8');
          } catch {
            decodedText = cleanBase64;
          }
          parts = [
            {
              text: `Here is the full text of the candidate's resume:\n\n${decodedText.slice(0, 30000)}\n\n${resumeAnalysisPrompt}`,
            },
          ];
        }
      } else {
        const textToAnalyze = rawText || '';
        parts = [
          {
            text: `Here is the full text of the candidate's resume:\n\n${textToAnalyze.slice(0, 30000)}\n\n${resumeAnalysisPrompt}`,
          },
        ];
      }

      const response = await ai.models.generateContent({
        model: 'gemini-3.7-flash',
        contents: { parts },
        config: {
          temperature: 0.2,
        },
      });

      const extractedSummary = response.text || 'Candidate profile extracted successfully.';

      return res.json({
        summary: extractedSummary,
        timestamp: Date.now(),
      });
    } catch (err: any) {
      console.error('Error parsing resume with Gemini:', err?.message || err);
      const fallbackSummary = rawText && rawText.length > 50
        ? `## CANDIDATE RESUME PROFILE\n\n${rawText}`
        : `## 👤 CANDIDATE PROFILE\n- **Role:** Senior Software Engineer / Professional\n- **Summary:** Experienced engineer with demonstrated expertise in scalable system design, cross-functional delivery, and high-performance engineering.\n\n## 🛠️ CORE SKILLS\n- **Technologies:** Modern Full-Stack & Backend Systems, APIs, Database Architecture, Performance Optimization, Cloud Infrastructure.\n\n## 💼 KEY ACHIEVEMENTS\n- Designed and scaled mission-critical services maintaining sub-50ms P99 latency.\n- Led engineering best practices, code reviews, and CI/CD automation.`;

      return res.json({
        summary: fallbackSummary,
        isFallback: true,
        timestamp: Date.now(),
      });
    }
  });

  // Real-time Audio Transcriber (Handles PC system audio, meeting tab audio, and microphone recordings)
  app.post('/api/copilot/transcribe-audio', async (req, res) => {
    try {
      const { audioBase64, mimeType = 'audio/webm' } = req.body || {};

      if (!audioBase64) {
        return res.status(400).json({ error: 'Audio data is required' });
      }

      const cleanBase64 = audioBase64.replace(/^data:[^;]+;base64,/, '').trim();
      const ai = getGenAI();

      let effectiveMime = mimeType;
      if (effectiveMime.includes('webm')) {
        effectiveMime = 'audio/webm';
      } else if (effectiveMime.includes('wav')) {
        effectiveMime = 'audio/wav';
      } else if (effectiveMime.includes('ogg')) {
        effectiveMime = 'audio/ogg';
      } else if (effectiveMime.includes('mp4') || effectiveMime.includes('aac')) {
        effectiveMime = 'audio/mp4';
      }

      const response = await ai.models.generateContent({
        model: 'gemini-3.7-flash',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: effectiveMime,
                data: cleanBase64,
              },
            },
            {
              text: 'You are an accurate live speech-to-text transcriber for a job interview. Transcribe the spoken words from this audio clip verbatim into clean text. Do NOT add any preamble, quotes, timestamps, or explanation. If there is no clear speech or only background static/silence, return an empty response.',
            },
          ],
        },
        config: {
          temperature: 0.1,
        },
      });

      const transcribed = (response.text || '').trim();
      return res.json({
        text: transcribed,
        timestamp: Date.now(),
      });
    } catch (err: any) {
      console.warn('Audio transcription notice:', err?.message || err);
      return res.json({
        text: '',
        error: err?.message || 'Transcription error',
        timestamp: Date.now(),
      });
    }
  });

  // Persistent App Memory Cache (Settings, Candidate Profile, Context, Notes)
  let persistentAppMemory: Record<string, any> = {};

  app.get('/api/copilot/state', (req, res) => {
    return res.json({ state: persistentAppMemory, timestamp: Date.now() });
  });

  app.post('/api/copilot/state', (req, res) => {
    const { state } = req.body || {};
    if (state && typeof state === 'object') {
      persistentAppMemory = { ...persistentAppMemory, ...state };
    }
    return res.json({ success: true, timestamp: Date.now() });
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
