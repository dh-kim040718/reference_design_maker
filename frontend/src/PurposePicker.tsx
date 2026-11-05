import {useEffect,useId,useRef,useState,type KeyboardEvent} from 'react'
import {applyPurpose,purposeGroups,purposeSizeLabel,type DesignSettings} from './lib/designSettings'

const choices=purposeGroups.flatMap(group=>group.items)
export function PurposePicker({value,onChange,disabled}:{value:DesignSettings;onChange:(value:DesignSettings)=>void;disabled:boolean}) {
  const [open,setOpen]=useState(false)
  const [active,setActive]=useState(0)
  const root=useRef<HTMLDivElement>(null)
  const trigger=useRef<HTMLButtonElement>(null)
  const id=useId()
  const selected=choices.findIndex(([key])=>key===value.purpose)
  useEffect(()=>{
    if(!open) return
    const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node)) setOpen(false)}
    document.addEventListener('pointerdown',outside)
    return ()=>document.removeEventListener('pointerdown',outside)
  },[open])
  useEffect(()=>{if(open) document.getElementById(`${id}-option-${active}`)?.scrollIntoView?.({block:'nearest'})},[open,active,id])
  function select(purpose:string) {onChange(applyPurpose(value,purpose));setOpen(false);trigger.current?.focus()}
  function keyboard(event:KeyboardEvent<HTMLButtonElement>) {
    if(event.key==='Tab'){setOpen(false);return}
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);return}
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      event.preventDefault()
      if(!open){setActive(Math.max(0,selected));setOpen(true);return}
      setActive(index=>event.key==='Home'?0:event.key==='End'?choices.length-1:Math.max(0,Math.min(choices.length-1,index+(event.key==='ArrowDown'?1:-1))))
    } else if(event.key==='Enter'||event.key===' ') {
      event.preventDefault()
      if(open) select(choices[active][0])
      else {setActive(Math.max(0,selected));setOpen(true)}
    }
  }
  return <div className="design-purpose-picker" ref={root}>
    <span id={`${id}-label`} className="design-purpose-label">사용 목적</span>
    <button type="button" ref={trigger} role="combobox" className="design-purpose-trigger" aria-labelledby={`${id}-label`} aria-describedby={`${id}-selection ${id}-current`} aria-haspopup="listbox" aria-expanded={open&&!disabled} aria-controls={`${id}-list`} aria-activedescendant={open?`${id}-option-${active}`:undefined} disabled={disabled} onKeyDown={keyboard} onClick={()=>{setActive(Math.max(0,selected));setOpen(previous=>!previous)}}>
      <span id={`${id}-selection`}>{choices[selected]?.[1]||'자유 시안'}</span><span id={`${id}-current`} className="design-purpose-current-size">{value.width} × {value.height} {value.unit}</span><span aria-hidden="true">⌄</span>
    </button>
    {open&&!disabled && <div className="design-purpose-popover"><div role="listbox" id={`${id}-list`} aria-labelledby={`${id}-label`} className="design-purpose-list">{purposeGroups.map(group=><div role="group" aria-label={group.name} key={group.name}><div className="design-purpose-group-label">{group.name}</div>{group.items.map(([key,label])=>{
      const index=choices.findIndex(([item])=>item===key)
      return <button type="button" role="option" tabIndex={-1} id={`${id}-option-${index}`} key={key} data-value={key} aria-label={label} aria-describedby={`${id}-size-${index}`} aria-selected={value.purpose===key} className={`design-purpose-option${active===index?' is-active':''}`} onPointerMove={()=>setActive(index)} onMouseDown={event=>event.preventDefault()} onClick={()=>select(key)}><span>{label}</span><span id={`${id}-size-${index}`}>{purposeSizeLabel(key)}</span></button>
    })}</div>)}</div><p className="design-purpose-help">선택하면 기본 크기 적용 · 아래에서 자유롭게 수정</p></div>}
  </div>
}
