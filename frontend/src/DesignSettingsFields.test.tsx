import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {DesignSettingsFields} from './DesignSettingsFields'
import {defaultDesignSettings,designPreview,purposePresets,applyPurpose} from './lib/designSettings'
import {useState} from 'react'
afterEach(cleanup)

it('offers designer units and broad purposes, showing physical size as pixels',()=>{
  render(<DesignSettingsFields value={{...defaultDesignSettings,unit:'mm',width:210,height:297}} disabled={false} onChange={vi.fn()}/>)
  expect(screen.getByText('출력 2,480 × 3,508 px')).toBeInTheDocument()
  expect(screen.getByLabelText('해상도 (ppi)')).toHaveValue(300)
  for(const name of ['픽셀 (px)','밀리미터 (mm)','센티미터 (cm)','인치 (in)','포인트 (pt)']) expect(screen.getByRole('option',{name})).toBeInTheDocument()
  fireEvent.click(screen.getByRole('combobox',{name:'사용 목적'}))
  for(const name of ['패키지·라벨','책·잡지·편집물']) expect(screen.getByRole('option',{name})).toBeInTheDocument()
})

it('applies a purpose preset, allows manual edits, and preserves them for custom purpose',()=>{
  function Editor(){const [value,setValue]=useState(defaultDesignSettings);return <DesignSettingsFields value={value} disabled={false} onChange={setValue}/>}
  render(<Editor/>)
  fireEvent.click(screen.getByRole('combobox',{name:'사용 목적'}))
  expect(screen.getByRole('option',{name:'포스터'})).toHaveTextContent('A4 · 210 × 297 mm')
  fireEvent.click(screen.getByRole('option',{name:'포스터'}))
  expect(screen.getByLabelText('가로')).toHaveValue(210)
  expect(screen.getByLabelText('세로')).toHaveValue(297)
  expect(screen.getByLabelText('크기 단위')).toHaveValue('mm')
  fireEvent.change(screen.getByLabelText('가로'),{target:{value:'200'}})
  expect(screen.getByRole('combobox',{name:'사용 목적'})).toHaveTextContent('200 × 297 mm')
  fireEvent.click(screen.getByRole('combobox',{name:'사용 목적'}))
  fireEvent.click(screen.getByRole('option',{name:'직접 입력'}))
  expect(screen.getByLabelText('가로')).toHaveValue(200)
})

it('all purpose presets satisfy the current output constraints',()=>{
  for(const purpose of Object.keys(purposePresets)) expect(designPreview(applyPurpose(defaultDesignSettings,purpose)).error).toBe('')
})

it('supports keyboard selection and Escape without losing edits',()=>{
  const change=vi.fn()
  render(<DesignSettingsFields value={defaultDesignSettings} disabled={false} onChange={change}/>)
  const picker=screen.getByRole('combobox',{name:'사용 목적'})
  fireEvent.keyDown(picker,{key:'ArrowDown'})
  fireEvent.keyDown(picker,{key:'End'})
  fireEvent.keyDown(picker,{key:'Escape'})
  expect(change).not.toHaveBeenCalled()
  expect(picker).toHaveAttribute('aria-expanded','false')
  fireEvent.keyDown(picker,{key:'ArrowDown'})
  fireEvent.keyDown(picker,{key:'End'})
  fireEvent.keyDown(picker,{key:'Enter'})
  expect(change).toHaveBeenCalledWith(expect.objectContaining({purpose:'illustration',width:1600,height:1600,unit:'px'}))
})
it('converts unit values rather than treating the same number as a different physical size',()=>{
  const change=vi.fn()
  render(<DesignSettingsFields value={{...defaultDesignSettings,unit:'in',width:2,height:3}} disabled={false} onChange={change}/>)
  fireEvent.change(screen.getByLabelText('크기 단위'),{target:{value:'mm'}})
  expect(change).toHaveBeenCalledWith(expect.objectContaining({unit:'mm',width:50.8,height:76.2}))
})
it('rejects unsupported pixel counts and requests a custom purpose description',()=>{
  expect(designPreview({...defaultDesignSettings,width:4000,height:500}).error).toContain('3배')
  expect(designPreview({...defaultDesignSettings,unit:'cm',width:21,height:29.7}).width).toBe(2480)
  expect(designPreview({...defaultDesignSettings,purpose:'other'}).error).toContain('사용 목적')
})
