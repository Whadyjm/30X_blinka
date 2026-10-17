import Markdown from 'react-markdown';

/** Render model text as a bounded Markdown subset. HTML and remote images never render. */
export function ChatText({ text }: { text: string }) {
  return <div className="chat-prose min-w-0 [overflow-wrap:anywhere]">
    <Markdown skipHtml allowedElements={['p', 'strong', 'em', 'ul', 'ol', 'li', 'a', 'code', 'pre', 'br', 'blockquote', 'h1', 'h2', 'h3', 'hr']}
      components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">{children}</a> }}>
      {text}
    </Markdown>
  </div>;
}
