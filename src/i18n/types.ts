/** 界面语言：默认简体中文 */
export type AppLocale = 'zh-CN' | 'en';

export type TParams = Record<string, string | number | boolean | undefined>;

export type TFunction = (key: string, params?: TParams) => string;
