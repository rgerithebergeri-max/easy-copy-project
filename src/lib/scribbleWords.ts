export const SCRIBBLE_WORDS = [
  'kutya','macska','ház','fa','nap','hold','autó','busz','vonat','repülő','hajó','telefon','pizza','alma','banán',
  'labda','óra','szív','korona','kalap','cipő','szemüveg','kulcs','ajtó','ablak','virág','felhő','eső','villám',
  'hóember','robot','űrhajó','sárkány','szellem','boszorkány','kalóz','nindzsa','lovag','király','királynő',
  'fagyi','hamburger','torta','palacsinta','popcorn','kávé','tea','csoki','sajt','kenyér','hot dog',
  'elefánt','oroszlán','tigris','nyúl','róka','medve','pingvin','kacsa','béka','hal','cápa','polip','pók','méh',
  'gitár','dob','zongora','mikrofon','fülhallgató','kamera','tévé','laptop','egér','billentyűzet',
  'foci','kosár','tenisz','gördeszka','bicikli','roller','úszás','síelés','korcsolya','súlyzó',
  'zsiráf','pizza','űrhajó','sárkány','varázsló','dinoszaurusz','jégkrém','robot','egyszarvú','táltos',
  'kacsa','traktor','telefon','tévé','számítógép','vonat','repülő','tengeralattjáró','bicikli','kerékpár',
  'almafa','körte','görögdinnye','hamburger','sushi','tészta','tortás','fagyi','csoki','sajt',
  'oroszlán','elefánt','tigris','pingvin','medve','farkas','róka','nyúl','sün','denevér',
  'kalóz','lovag','király','királynő','herceg','hercegnő','tündér','manó','boszorkány','vámpír',
  'piramis','iglu','kastély','vízesés','vulkán','sziget','dzsungel','sivatag','tundra','barlang',
  'gitár','dob','zongora','hegedű','trombita','fülhallgató','mikrofon','hangfal','headset','kazetta',
  'hold','nap','csillag','rakéta','földgömb','meteorit','üstökös','galaxis','kvazár','idegen',
  'tükör','lámpa','kanapé','könyvespolc','függöny','párna','takaró','asztal','szék','komód',
  'futball','kosárlabda','tenisz','snowboard','sí','korcsolya','úszás','kötélmászás','jóga','futás',
  'esernyő','táska','sapka','csizma','kesztyű','sál','napszemüveg','óra','gyűrű','nyaklánc',
  'hokis','kalapács','fűrész','csavarhúzó','csavar','fogaskerék','csavarkulcs','téglafal','vakolat','festék',
  'kávé','tea','limonádé','smoothie','milkshake','popcorn','pite','muffin','fánk','palacsinta',
  'sárkányhajó','léghajó','sárkányrepülő','jetski','quad','autó','busz','motor','siklórepülő','helikopter',
  'krokodil','flamingó','páva','panda','koala','kenguru','wombat','okapi','hangya','méhecske',
  'tornádó','hurrikán','szivárvány','napfogyatkozás','holdtölte','aurora','meteorzápor','csillaghullás','sarki fény','virágeső',
];

export function pickScribbleWord(custom?: string, used?: Set<string>): string {
  let pool: string[] = [];
  if (custom) {
    pool = custom.split(',').map((w) => w.trim()).filter(Boolean);
  }
  if (pool.length === 0) pool = Array.from(new Set(SCRIBBLE_WORDS));
  const available = used ? pool.filter((w) => !used.has(w.toLowerCase())) : pool;
  const final = available.length > 0 ? available : pool;
  return final[Math.floor(Math.random() * final.length)];
}
