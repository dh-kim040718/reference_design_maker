import type { MouseEvent, ReactNode } from 'react'

export function ProjectHeader({projectId, typeId, name, active, count, navigate, children}: {
  projectId: string; typeId?: string; name: string; active: 'references' | 'generation'; count: number
  navigate: (path: string) => void; children?: ReactNode
}) {
  const follow = (path: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) {event.preventDefault(); navigate(path)}
  }
  const base = `/projects/${projectId}`
  const referencePath = typeId ? `${base}/types/${typeId}` : base
  const generationPath = `${base}/generate${typeId ? `?type=${encodeURIComponent(typeId)}` : ''}`
  return <header className="project-library-header">
    <a className="project-back" href={active === 'generation' ? referencePath : '/projects'} onClick={follow(active === 'generation' ? referencePath : '/projects')} aria-label={active === 'generation' ? '레퍼런스로 돌아가기' : '프로젝트 목록으로'} title={active === 'generation' ? '레퍼런스로 돌아가기' : '프로젝트 목록으로'}>←</a>
    <h1 title={name}>{name}</h1>
    <nav aria-label="현재 작업" className="project-workflow-context">
      {active === 'generation' ? <><a href={referencePath} onClick={follow(referencePath)}>레퍼런스</a><span aria-hidden="true">/</span><span aria-current="page">시안 만들기</span></> : <span aria-current="page">레퍼런스 <span className="project-reference-count">{count}</span></span>}
    </nav>
    {active === 'references' && <a className="project-history-link" href={`${generationPath}#history`} onClick={follow(`${generationPath}#history`)}>시안 이력</a>}
    {children}
  </header>
}
