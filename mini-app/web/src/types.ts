export interface Session { id: number; ts?: string; format: string; question_text?: string; answer_transcript?: string;
  score?: number; rephrases?: { original: string; improved: string }[]; model_answer?: string; weak_vocab?: string[]; }
export interface Settings { nudge_time?: string; skip_weekends?: boolean; timezone?: string; per_day_target?: number;
  tts_voice?: string; format_weights?: Record<string, number>; }
