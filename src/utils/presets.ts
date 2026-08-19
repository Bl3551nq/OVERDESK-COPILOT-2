import { PersonaType } from '../types';

export interface PersonaInfo {
  id: PersonaType;
  title: string;
  badge: string;
  icon: string;
  description: string;
  recommendedRoles: string[];
  defaultPromptTone: string;
}

export const PERSONAS: Record<PersonaType, PersonaInfo> = {
  research: {
    id: 'research',
    title: 'Research',
    badge: 'Empirical & Deep Tech',
    icon: '🔬',
    description: 'Methodical, theoretical depth, hypothesis testing, literature references, and clear trade-off analysis.',
    recommendedRoles: ['Research Scientist', 'AI/ML Engineer', 'Data Scientist', 'PhD Fellow'],
    defaultPromptTone: 'Analytical & Evidence-Based',
  },
  job: {
    id: 'job',
    title: 'Job Behavior',
    badge: 'STAR Leadership',
    icon: '💼',
    description: 'Executive presence, STAR method (Situation, Task, Action, Result), leadership, conflict resolution, and business metrics.',
    recommendedRoles: ['Product Manager', 'Engineering Manager', 'Director / VP', 'General Behavioral'],
    defaultPromptTone: 'Structured & Impact-Driven',
  },
  coding: {
    id: 'coding',
    title: 'Coding',
    badge: 'Principal Architecture',
    icon: '💻',
    description: 'Clean data structures, algorithmic complexity (Time/Space O(n)), edge case handling, and production-grade software patterns.',
    recommendedRoles: ['Full-Stack Engineer', 'Backend Specialist', 'Systems Architect', 'Frontend Lead'],
    defaultPromptTone: 'Precise & Algorithmic',
  },
  design: {
    id: 'design',
    title: 'Design',
    badge: 'Product & UX Heuristics',
    icon: '🎨',
    description: 'User-centered design principles, accessibility (WCAG), design systems, user journeys, design critique, and trade-off rationale.',
    recommendedRoles: ['Product Designer', 'UX/UI Lead', 'Design Systems Engineer', 'UX Researcher'],
    defaultPromptTone: 'Empathetic & Heuristic',
  },
};

export interface SampleQuestionPreset {
  id: string;
  persona: PersonaType;
  question: string;
  category: string;
  previewAnswer: string;
}

export const SAMPLE_QUESTIONS: SampleQuestionPreset[] = [
  {
    id: 'coding-1',
    persona: 'coding',
    question: "Walk me through how you'd approach designing a real-time collaborative document editor like Google Docs.",
    category: 'System Design',
    previewAnswer: "I'd start by establishing our consistency model—utilizing Operational Transformation (OT) or Conflict-free Replicated Data Types (CRDTs) over WebSockets. For persistence, a distributed log with periodic snapshots ensures linearizable state updates and sub-50ms sync.",
  },
  {
    id: 'coding-2',
    persona: 'coding',
    question: 'How do you optimize a database query experiencing severe latency under 50,000 requests per second?',
    category: 'Backend & DB',
    previewAnswer: "I inspect the query execution plan with EXPLAIN ANALYZE to identify full table scans and missing composite indexes. Next, I implement read replicas and a Redis caching layer with a Cache-Aside pattern to offload 90% of redundant reads.",
  },
  {
    id: 'job-1',
    persona: 'job',
    question: 'Tell me about a time you had a fundamental technical disagreement with a teammate or stakeholder.',
    category: 'Behavioral / STAR',
    previewAnswer: "At my previous role, a senior engineer proposed a complete rewrite to Rust while our milestone deadline was 6 weeks out. I scheduled a spike to benchmark the performance gains versus deliverability risk. By presenting data on our actual throughput bottlenecks, we agreed to optimize the critical hot paths in Go instead, hitting our release on schedule with zero downtime.",
  },
  {
    id: 'job-2',
    persona: 'job',
    question: 'Describe your most impactful project and how you measured its success.',
    category: 'Leadership & Metrics',
    previewAnswer: "I spearheaded the migration of our checkout pipeline to an asynchronous event-driven architecture, reducing P99 latency by 68% and improving peak checkout conversions by 4.2%, which drove $1.8M in incremental annual revenue.",
  },
  {
    id: 'design-1',
    persona: 'design',
    question: 'How do you approach creating and governing a multi-platform Design System from scratch?',
    category: 'Design Systems',
    previewAnswer: "I start by establishing a foundational token architecture—semantic colors, typography scale, spacing units, and elevation. I partner with engineering to co-locate component contracts in Figma and React/Storybook, governed by strict versioning and accessibility audits.",
  },
  {
    id: 'research-1',
    persona: 'research',
    question: 'How do you mitigate catastrophic forgetting when fine-tuning large language models on domain-specific corpora?',
    category: 'ML / Research',
    previewAnswer: "I utilize Parameter-Efficient Fine-Tuning (PEFT) techniques such as LoRA or QLoRA with rank stabilization, combined with Experience Replay that intersperses 10-15% of the original pretraining dataset during instruction tuning to preserve baseline reasoning.",
  },
];
