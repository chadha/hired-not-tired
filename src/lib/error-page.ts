export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>This page didn't load</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font: 15px/1.5 Inter, system-ui, -apple-system, sans-serif; background: #FFFFFF; color: #14213D; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      .card { max-width: 28rem; width: 100%; text-align: center; padding: 2rem; border: 1px solid #E5E7EB; border-radius: 20px; background: #F4F6FA; }
      h1 { font-family: "Space Grotesk", sans-serif; font-size: 1.25rem; letter-spacing: -0.02em; margin: 0 0 0.5rem; }
      p { color: #4B5563; margin: 0 0 1.5rem; }
      .actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
      a, button { padding: 0.5rem 1rem; border-radius: 12px; font: inherit; cursor: pointer; text-decoration: none; border: 1px solid transparent; }
      a:focus-visible, button:focus-visible { outline: 2px solid #E4572E; outline-offset: 3px; }
      .primary { background: #14213D; color: #FFFFFF; }
      .secondary { background: #FFFFFF; color: #14213D; border-color: #E5E7EB; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>This page didn't load</h1>
      <p>Something went wrong on our end. You can try refreshing or head back home.</p>
      <div class="actions">
        <button class="primary" onclick="location.reload()">Try again</button>
        <a class="secondary" href="/">Go home</a>
      </div>
    </div>
  </body>
</html>`;
}