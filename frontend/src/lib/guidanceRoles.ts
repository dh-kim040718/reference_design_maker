export const roleGroups = [
  {name: '스타일', roles: ['mood', 'color', 'typography', 'icons', 'imagery']},
  {name: '구조', roles: ['layout', 'spacing', 'hierarchy', 'density']},
  {name: 'UI 요소', roles: ['components', 'buttons', 'navigation', 'forms', 'tables', 'charts', 'surfaces']},
]

export const guidanceRoles: Record<string, {label: string; description: string}> = {
  mood: {label: '분위기', description: '전체적인 인상과 시각적 톤'},
  color: {label: '컬러', description: '배경·강조·상태 색상의 조합과 대비'},
  typography: {label: '타이포그래피', description: '서체 인상·크기·굵기·행간·자간'},
  icons: {label: '아이콘', description: '선 두께·채움·크기·아이콘과 텍스트의 조합'},
  imagery: {label: '이미지·일러스트', description: '사진·일러스트의 스타일과 배치 방식'},
  layout: {label: '레이아웃', description: '그리드·정렬·영역 배치와 비율'},
  spacing: {label: '여백·간격', description: '패딩·요소 간격·섹션 간 여백'},
  hierarchy: {label: '정보 위계', description: '중요도에 따른 강조와 시선 흐름'},
  density: {label: '정보 밀도', description: '한 화면에 표시되는 정보량과 압축 정도'},
  components: {label: '컴포넌트', description: '카드·배지·탭 등 반복 UI의 구성'},
  buttons: {label: '버튼·CTA', description: '주요 행동의 위치·크기·강조와 버튼 위계'},
  navigation: {label: '내비게이션', description: '헤더·사이드바·탭·메뉴의 시각적 구성'},
  forms: {label: '입력·폼', description: '입력창·선택 요소·레이블·검증 안내의 배치'},
  tables: {label: '테이블·리스트', description: '행·열·정렬·목록과 데이터 표현'},
  charts: {label: '차트·지표', description: '그래프·범례·KPI와 수치의 시각화'},
  surfaces: {label: '테두리·입체감', description: '모서리 반경·구분선·테두리·그림자'},
}
