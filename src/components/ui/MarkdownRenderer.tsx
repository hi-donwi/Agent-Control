import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useCallback, useState, type ReactNode } from 'react';
import { UIDLPreview, isUIDLDocument } from '../chat/UIDLPreview';

interface Props {
  content: string;
}

export function MarkdownRenderer({ content }: Props) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        pre: ({ children }) => <>{children}</>,
        code: CodeBlock,
      }}
    >
      {content}
    </Markdown>
  );
}

function CodeBlock({
  className,
  children,
  ...props
}: { className?: string; children?: ReactNode }) {
  const match = /language-(\w+)/.exec(className ?? '');
  const lang = match?.[1] ?? '';
  const codeStr = String(children).replace(/\n$/, '');
  const isInline = !className && !String(children).includes('\n');

  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(codeStr).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [codeStr]);

  if (isInline) {
    return <code {...props}>{children}</code>;
  }

  // Detect and render UIDL documents interactively
  if (lang === 'uidl' || lang === 'json') {
    try {
      const parsed = JSON.parse(codeStr);
      if (isUIDLDocument(parsed)) {
        return <UIDLPreview code={codeStr} />;
      }
    } catch {
      // not valid JSON, fallback to standard code block
    }
  }

  return (
    <pre>
      <div className="code-header">
        <span>{lang || 'code'}</span>
        <button className="copy-btn" onClick={handleCopy} type="button">
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <code className={className} {...props}>
        {children}
      </code>
    </pre>
  );
}
