export interface DesignSettings {purpose: string; purpose_detail: string; width: number; height: number; unit: 'px'|'mm'|'cm'|'in'|'pt'; ppi: number}
export interface DesignSpecification extends DesignSettings {purpose_label: string; pixel_width: number; pixel_height: number; generation_width: number; generation_height: number}
export const defaultDesignSettings: DesignSettings = {purpose:'general',purpose_detail:'',width:1024,height:1024,unit:'px',ppi:300}
export const purposeGroups = [
  {name:'자유',items:[['general','자유 시안'],['other','직접 입력']]},
  {name:'웹·앱',items:[['mobile_ui','모바일 앱 화면'],['web_ui','웹사이트·웹앱'],['dashboard','대시보드·관리자'],['landing','랜딩페이지'],['commerce','쇼핑몰·상품 상세']]},
  {name:'콘텐츠·광고',items:[['social_post','SNS 게시물'],['social_story','스토리·숏폼 커버'],['ad_banner','광고·배너'],['thumbnail','콘텐츠 썸네일'],['presentation','프레젠테이션'],['infographic','인포그래픽']]},
  {name:'인쇄·편집',items:[['poster','포스터'],['flyer','전단·리플렛'],['business_card','명함·카드'],['brochure','브로슈어·카탈로그'],['editorial','책·잡지·편집물']]},
  {name:'브랜드·그래픽',items:[['branding','브랜딩·로고 콘셉트'],['packaging','패키지·라벨'],['illustration','일러스트·키비주얼']]},
]
export const unitOptions = [['px','픽셀 (px)'],['mm','밀리미터 (mm)'],['cm','센티미터 (cm)'],['in','인치 (in)'],['pt','포인트 (pt)']] as const
type PurposePreset = Pick<DesignSettings,'width'|'height'|'unit'|'ppi'> & {name?:string}
const pixels=(width:number,height:number):PurposePreset=>({width,height,unit:'px',ppi:96})
const print=(width:number,height:number,name?:string):PurposePreset=>({width,height,unit:'mm',ppi:300,name})
export const purposePresets:Record<string,PurposePreset> = {
  general:{width:1024,height:1024,unit:'px',ppi:300},
  mobile_ui:pixels(390,844),web_ui:pixels(1440,900),dashboard:pixels(1440,900),landing:pixels(1440,1080),commerce:pixels(1080,1440),
  social_post:pixels(1080,1350),social_story:pixels(1080,1920),ad_banner:pixels(1200,628),thumbnail:pixels(1280,720),presentation:pixels(1920,1080),infographic:pixels(1080,1920),
  poster:print(210,297,'A4'),flyer:print(148,210,'A5'),business_card:print(90,50),brochure:print(210,297,'A4'),editorial:print(210,297,'A4'),
  branding:pixels(1024,1024),packaging:print(100,150),illustration:pixels(1600,1600),
}
export function purposeSizeLabel(purpose:string) {
  const preset=purposePresets[purpose]
  return preset ? `${preset.name ? preset.name+' · ' : ''}${preset.width} × ${preset.height} ${preset.unit}` : '현재 크기 유지'
}
export function applyPurpose(value:DesignSettings,purpose:string):DesignSettings {
  const preset=purposePresets[purpose]
  return preset ? {...value,purpose,purpose_detail:'',width:preset.width,height:preset.height,unit:preset.unit,ppi:preset.ppi} : {...value,purpose}
}
export function unitFactor(unit: DesignSettings['unit'], ppi: number) {return {px:1,mm:ppi/25.4,cm:ppi/2.54,in:ppi,pt:ppi/72}[unit]}
export function designPreview(settings: DesignSettings) {
  const {width,height,unit,ppi} = settings
  if (![width,height,ppi].every(Number.isFinite) || width<=0 || height<=0 || width>100000 || height>100000 || !Number.isInteger(ppi) || ppi<36 || ppi>600) return {error:'가로·세로는 양수, 해상도는 36~600ppi 정수로 입력해 주세요.'}
  if (unit==='px' && (!Number.isInteger(width)||!Number.isInteger(height))) return {error:'픽셀 크기는 정수로 입력해 주세요.'}
  if (settings.purpose==='other' && !settings.purpose_detail.trim()) return {error:'사용 목적을 직접 입력해 주세요.'}
  const w=Math.round(width*unitFactor(unit,ppi)), h=Math.round(height*unitFactor(unit,ppi))
  if (Math.min(w,h)<16 || Math.max(w,h)>8192 || w*h>16000000) return {error:'출력은 각 변 16~8,192px, 합계 1,600만 픽셀 이내로 입력해 주세요.'}
  if (Math.max(w,h)>Math.min(w,h)*3) return {error:'현재 생성 모델은 가로·세로 길이 차이가 3배 이내인 규격을 지원합니다.'}
  const ratio=w/h, area=Math.min(8294400,Math.max(655360,w*h))
  let best={score:Infinity,w:1024,h:1024}
  for(let x=16;x<=3840;x+=16) {
    const ideal=Math.round(x/ratio/16)*16
    for(const y of [ideal-16,ideal,ideal+16]) {
      if(y<16||y>3840||x/y<1/3||x/y>3||x*y<655360||x*y>8294400) continue
      const score=Math.abs(Math.log((x/y)/ratio))*12+Math.abs(Math.log(x*y/area))
      if(score<best.score) best={score,w:x,h:y}
    }
  }
  return {error:'',width:w,height:h,generationWidth:best.w,generationHeight:best.h}
}
