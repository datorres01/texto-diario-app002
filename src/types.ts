export interface DailyTextData {
  date: string;
  dateTitle: string;
  themeScripture: string;
  bodyParagraphs: string[];
  studyReference: string;
  publicationTitle: string;
  reference: string;
  sourceUrl: string;
  spokenText: string;
}

export type DayKey = '1' | '2' | '3' | '4' | '5' | '6' | '0';

export interface DaySchedule {
  enabled: boolean;
  time: string; // HH:MM (24-hour format)
}

export type WeeklySchedule = Record<DayKey, DaySchedule>;

export type VoiceName = 'Kore' | 'Zephyr' | 'Puck' | 'Charon' | 'Fenrir';

export type ChimeType = 'chime' | 'harp' | 'tone';

export type ThemeMode = 'light' | 'dark';

export interface AppSettings {
  alarmMasterEnabled: boolean;
  autoReadOnAlarm: boolean;
  keepScreenAwake: boolean;
  voiceName: VoiceName;
  chimeType: ChimeType;
  speechRate: number;
  theme: ThemeMode;
  schedule: WeeklySchedule;
}

export type AlarmStage =
  | 'idle'
  | 'ringing'
  | 'announcing'
  | 'reading'
  | 'paused';

export type AppTab = 'today' | 'schedule' | 'voice';
