import type { MouseEvent, ReactNode } from 'react'

export function ProjectHeader({projectId, name, active, count, navigate, children}: {
  projectId: string; name: string; active: 'references' | 'generation'; count: number
  navigate: (path: string) => void; children?: ReactNode
}) {
  const follow = (path: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) {event.preventDefault(); navigate(path)}
  }
  const base = `/projects/${projectId}`
  return <header className="project-library-header">
    <a className="project-back" href="/projects" onClick={follow('/projects')} aria-label="프로젝트 목록으로" title="프로젝트 목록으로">←</a>
    <h1 title={name}>{name}</h1>
    <nav aria-label="프로젝트 작업" className="project-library-tabs">
      <a className={active === 'references' ? 'active' : ''} aria-current={active === 'references' ? 'page' : undefined} href={base} onClick={follow(base)}>레퍼런스</a>
      <a className={active === 'generation' ? 'active' : ''} aria-current={active === 'generation' ? 'page' : undefined} href={`${base}/generate`} onClick={follow(`${base}/generate`)}>AI 시안</a>
    </nav>
    <span className="project-reference-count" title="레퍼런스 개수">{count}개</span>
    {children}
  </header>
}
