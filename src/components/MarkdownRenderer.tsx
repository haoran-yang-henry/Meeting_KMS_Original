import ReactMarkdown from 'react-markdown';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export const MarkdownRenderer = ({ content, className = '' }: MarkdownRendererProps) => {
  return (
    <div className={`prose prose-sm dark:prose-invert max-w-none ${className}`}>
      <ReactMarkdown
        components={{
          // Style headings
          h1: ({ children }) => (
            <h1 className="text-lg font-bold mt-4 mb-2 first:mt-0">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-base font-semibold mt-3 mb-2 first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-sm font-semibold mt-2 mb-1">{children}</h3>
          ),
          // Style paragraphs
          p: ({ children }) => (
            <p className="text-sm mb-2 last:mb-0">{children}</p>
          ),
          // Style lists
          ul: ({ children }) => (
            <ul className="list-disc list-inside text-sm mb-2 space-y-1">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal list-inside text-sm mb-2 space-y-1">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="text-sm">{children}</li>
          ),
          // Style code
          code: ({ children, className: codeClassName }) => {
            const isInline = !codeClassName;
            return isInline ? (
              <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">{children}</code>
            ) : (
              <code className="block bg-muted p-2 rounded text-xs font-mono overflow-x-auto">{children}</code>
            );
          },
          // Style blockquotes
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-primary/50 pl-3 italic text-sm text-muted-foreground my-2">
              {children}
            </blockquote>
          ),
          // Style horizontal rules
          hr: () => <hr className="my-3 border-border" />,
          // Style strong/bold
          strong: ({ children }) => (
            <strong className="font-semibold">{children}</strong>
          ),
          // Style links
          a: ({ children, href }) => (
            <a href={href} className="text-primary underline hover:no-underline" target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
