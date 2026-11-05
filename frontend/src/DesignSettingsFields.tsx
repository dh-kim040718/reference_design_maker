import {designPreview,unitFactor,unitOptions,type DesignSettings} from './lib/designSettings'
import {PurposePicker} from './PurposePicker'

export function DesignSettingsFields({value,onChange,disabled}: {value:DesignSettings;onChange:(value:DesignSettings)=>void;disabled:boolean}) {
  const preview=designPreview(value)
  return <fieldset className="design-settings-fields" disabled={disabled}>
    <PurposePicker value={value} onChange={onChange} disabled={disabled}/>
    {value.purpose==='other' && <label>사용 목적 직접 입력<input maxLength={200} value={value.purpose_detail} placeholder="예: 전시 공간 안내 그래픽" onChange={event=>onChange({...value,purpose_detail:event.target.value})}/></label>}
    <div className="design-dimensions">{(['width','height'] as const).map(key=><label key={key}>{key==='width'?'가로':'세로'}<input type="number" inputMode="decimal" min={value.unit==='px'?1:.01} step={value.unit==='px'?1:'any'} value={Number.isFinite(value[key])?value[key]:''} onChange={event=>onChange({...value,[key]:event.target.valueAsNumber})}/></label>)}<label>단위<select aria-label="크기 단위" value={value.unit} onChange={event=>{
      const unit=event.target.value as DesignSettings['unit'], factor=unitFactor(value.unit,value.ppi)/unitFactor(unit,value.ppi)
      const convert=(n:number)=>unit==='px'?Math.round(n*factor):Math.round(n*factor*100)/100
      onChange({...value,unit,width:convert(value.width),height:convert(value.height)})
    }}>{unitOptions.map(([unit,label])=><option value={unit} key={unit} label={unit} aria-label={label}>{label}</option>)}</select></label></div>
    {value.unit!=='px' && <label className="design-ppi">해상도 (ppi)<input type="number" min={36} max={600} step={1} list="design-ppi-values" value={Number.isFinite(value.ppi)?value.ppi:''} onChange={event=>onChange({...value,ppi:event.target.valueAsNumber})}/><datalist id="design-ppi-values">{[72,96,150,300,600].map(ppi=><option key={ppi} value={ppi}/>)}</datalist></label>}
    {preview.error ? <p className="error" role="status">{preview.error}</p> : <div className="design-output-preview"><strong>출력 {preview.width?.toLocaleString()} × {preview.height?.toLocaleString()} px</strong>{(preview.width!==preview.generationWidth||preview.height!==preview.generationHeight) && <details><summary>원본 생성 크기 안내</summary><p>AI 원본 {preview.generationWidth} × {preview.generationHeight}px를 지정한 출력 크기에 맞춥니다. 비율을 유지하며 필요한 경우 여백을 추가합니다. 원본보다 큰 출력은 확대됩니다.</p></details>}</div>}
  </fieldset>
}
