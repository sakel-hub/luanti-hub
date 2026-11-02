export async function onRequestPost() {
  return Response.json(
    { error: 'ContentDB account sync has been retired. Submit your Git repository via + Submit Git Repo to verify and claim packages.' },
    { status: 410 }
  );
}
