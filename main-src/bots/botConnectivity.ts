import { session } from 'electron';
import * as lark from '@larksuiteoapi/node-sdk';
import type { BotIntegrationConfig } from '../botSettingsTypes.js';
import { createJsonHttpInstance, electronProxyRulesFromUrl, requestJson, resolveIntegrationProxyUrl } from './platforms/common.js';

export type BotConnectivityResult = {
	ok: boolean;
	message: string;
};

function t(lang: 'zh-CN' | 'en', zh: string, en: string): string {
	return lang === 'en' ? en : zh;
}

function normalizeErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error ?? 'Unknown error');
}

async function testTelegram(integration: BotIntegrationConfig, lang: 'zh-CN' | 'en'): Promise<BotConnectivityResult> {
	const token = integration.telegram?.botToken?.trim() ?? '';
	if (!token) {
		return { ok: false, message: t(lang, '缺少 Bot Token。', 'Bot Token is required.') };
	}
	const ses = session.fromPartition(`async-bot-test-telegram-${integration.id}`);
	const proxyUrl = resolveIntegrationProxyUrl(integration);
	try {
		if (proxyUrl) {
			await ses.setProxy({
				mode: 'fixed_servers',
				proxyRules: electronProxyRulesFromUrl(proxyUrl),
			});
		} else {
			await ses.setProxy({ mode: 'direct' });
		}
		try {
			await ses.closeAllConnections();
		} catch {
			/* ignore */
		}
		const response = await ses.fetch(`https://api.telegram.org/bot${token}/getMe`);
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}
		const data = (await response.json()) as { ok?: boolean; description?: string; result?: { username?: string; first_name?: string } };
		if (!data.ok) {
			throw new Error(data.description || 'getMe failed');
		}
		const username = String(data.result?.username ?? '').trim();
		const firstName = String(data.result?.first_name ?? '').trim();
		return {
			ok: true,
			message:
				username || firstName
					? t(
							lang,
							`Telegram 已连接：${username ? `@${username}` : firstName}`,
							`Telegram connected: ${username ? `@${username}` : firstName}`
						)
					: t(lang, 'Telegram 已连接。', 'Telegram connected.'),
		};
	} catch (error) {
		return {
			ok: false,
			message: t(lang, `Telegram 连接失败：${normalizeErrorMessage(error)}`, `Telegram connection failed: ${normalizeErrorMessage(error)}`),
		};
	} finally {
		try {
			await ses.closeAllConnections();
		} catch {
			/* ignore */
		}
	}
}

async function testSlack(integration: BotIntegrationConfig, lang: 'zh-CN' | 'en'): Promise<BotConnectivityResult> {
	const botToken = integration.slack?.botToken?.trim() ?? '';
	const appToken = integration.slack?.appToken?.trim() ?? '';
	if (!botToken || !appToken) {
		return {
			ok: false,
			message: t(lang, '缺少 Bot Token 或 App Token。', 'Bot Token and App Token are required.'),
		};
	}
	const proxyUrl = resolveIntegrationProxyUrl(integration);
	try {
		const auth = await requestJson<{ ok?: boolean; error?: string; user_id?: string }>('https://slack.com/api/auth.test', {
			method: 'GET',
			headers: { authorization: `Bearer ${botToken}` },
			timeoutMs: 20_000,
			proxyUrl,
		});
		if (!auth.ok) {
			throw new Error(auth.error || 'auth.test failed');
		}
		const open = await requestJson<{ ok?: boolean; error?: string; url?: string }>('https://slack.com/api/apps.connections.open', {
			method: 'POST',
			headers: { authorization: `Bearer ${appToken}`, 'content-type': 'application/json' },
			body: {},
			timeoutMs: 20_000,
			proxyUrl,
		});
		if (!open.ok || !String(open.url ?? '').trim()) {
			throw new Error(open.error || 'Socket Mode URL missing');
		}
		return {
			ok: true,
			message: t(
				lang,
				`Slack 已连接${auth.user_id ? `：bot 用户 ${auth.user_id}` : ''}。`,
				`Slack connected${auth.user_id ? `: bot user ${auth.user_id}` : ''}.`
			),
		};
	} catch (error) {
		return {
			ok: false,
			message: t(lang, `Slack 连接失败：${normalizeErrorMessage(error)}`, `Slack connection failed: ${normalizeErrorMessage(error)}`),
		};
	}
}

async function testDiscord(integration: BotIntegrationConfig, lang: 'zh-CN' | 'en'): Promise<BotConnectivityResult> {
	const token = integration.discord?.botToken?.trim() ?? '';
	if (!token) {
		return { ok: false, message: t(lang, '缺少 Bot Token。', 'Bot Token is required.') };
	}
	const proxyUrl = resolveIntegrationProxyUrl(integration);
	try {
		const me = await requestJson<{ id?: string; username?: string; global_name?: string }>('https://discord.com/api/v10/users/@me', {
			method: 'GET',
			headers: { authorization: `Bot ${token}`, 'content-type': 'application/json' },
			timeoutMs: 20_000,
			proxyUrl,
		});
		const gateway = await requestJson<{ url?: string }>('https://discord.com/api/v10/gateway/bot', {
			method: 'GET',
			headers: { authorization: `Bot ${token}`, 'content-type': 'application/json' },
			timeoutMs: 20_000,
			proxyUrl,
		});
		const name = String(me.global_name ?? me.username ?? '').trim();
		if (!String(gateway.url ?? '').trim()) {
			throw new Error('Gateway URL missing');
		}
		return {
			ok: true,
			message: t(lang, `Discord 已连接${name ? `：${name}` : ''}。`, `Discord connected${name ? `: ${name}` : ''}.`),
		};
	} catch (error) {
		return {
			ok: false,
			message: t(lang, `Discord 连接失败：${normalizeErrorMessage(error)}`, `Discord connection failed: ${normalizeErrorMessage(error)}`),
		};
	}
}

async function testFeishu(integration: BotIntegrationConfig, lang: 'zh-CN' | 'en'): Promise<BotConnectivityResult> {
	const appId = integration.feishu?.appId?.trim() ?? '';
	const appSecret = integration.feishu?.appSecret?.trim() ?? '';
	if (!appId || !appSecret) {
		return { ok: false, message: t(lang, '缺少 App ID 或 App Secret。', 'App ID and App Secret are required.') };
	}
	try {
		const client = new lark.Client({
			appId,
			appSecret,
			httpInstance: createJsonHttpInstance(resolveIntegrationProxyUrl(integration)),
		});
		const result = await client.auth.v3.appAccessToken.internal({
			data: { app_id: appId, app_secret: appSecret },
		});
		if (Number(result.code ?? -1) !== 0) {
			throw new Error(String(result.msg ?? 'appAccessToken.internal failed'));
		}
		return {
			ok: true,
			message: t(lang, '飞书已连接，应用凭据有效。', 'Feishu connected. App credentials are valid.'),
		};
	} catch (error) {
		return {
			ok: false,
			message: t(lang, `飞书连接失败：${normalizeErrorMessage(error)}`, `Feishu connection failed: ${normalizeErrorMessage(error)}`),
		};
	}
}

export async function testBotIntegrationConnection(
	integration: BotIntegrationConfig,
	lang: 'zh-CN' | 'en'
): Promise<BotConnectivityResult> {
	switch (integration.platform) {
		case 'telegram':
			return await testTelegram(integration, lang);
		case 'slack':
			return await testSlack(integration, lang);
		case 'discord':
			return await testDiscord(integration, lang);
		case 'feishu':
			return await testFeishu(integration, lang);
		default:
			return {
				ok: false,
				message: t(lang, '暂不支持该平台的连通性测试。', 'Connectivity tests are not supported for this platform yet.'),
			};
	}
}
