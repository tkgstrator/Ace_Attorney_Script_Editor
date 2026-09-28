// 開発サーバーの章 API（server/cases-api.ts）を呼ぶ
async function check(res: Response): Promise<Response> {
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
  return res;
}

export async function listCases(): Promise<string[]> {
  return (await check(await fetch('/api/cases'))).json() as Promise<string[]>;
}

export async function readCase(name: string): Promise<string> {
  return (await check(await fetch(`/api/cases/${encodeURIComponent(name)}`))).text();
}

export async function writeCase(name: string, text: string): Promise<void> {
  await check(
    await fetch(`/api/cases/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/yaml; charset=utf-8' },
      body: text,
    }),
  );
}
