import { calibrationSchema, type Calibration } from '../shared/architecture'
export default function CalibrationFields({value,onChange,prefix='Architecture'}:{value:Calibration;onChange:(value:Calibration)=>void;prefix?:string}){
  const patch=(p:Partial<Calibration>)=>onChange({...value,...p})
  return <fieldset><legend>{prefix} calibration</legend><p>One grid edge. Facing is the model's authored forward direction; scale is uniform.</p>
    <label>{prefix} grid span<input type="number" value={1} readOnly /></label>
    <label>{prefix} facing<select value={value.facing} onChange={e=>patch({facing:e.target.value as Calibration['facing']})}>{['+Z','-Z','+X','-X'].map(v=><option key={v}>{v}</option>)}</select></label>
    <label>{prefix} alignment<select value={value.alignment} onChange={e=>patch({alignment:e.target.value as Calibration['alignment']})}>{['centre','start','end'].map(v=><option key={v}>{v}</option>)}</select></label>
    {(['scale','verticalOffset','horizontalOffset','rotationCorrection'] as const).map(key=><label key={key}>{prefix} {({scale:'scale',verticalOffset:'vertical offset',horizontalOffset:'horizontal offset',rotationCorrection:'rotation correction (degrees)'})[key]}<input type="number" step="any" min={key==='scale'?.05:key==='verticalOffset'?-10:key==='horizontalOffset'?-.5:-180} max={key==='scale'?10:key==='verticalOffset'?20:key==='horizontalOffset'?.5:180} value={value[key]} onChange={e=>patch({[key]:Number(e.target.value)})}/></label>)}
    <button type="button" onClick={()=>onChange(calibrationSchema.parse({}))}>Reset {prefix.toLowerCase()} calibration</button>
  </fieldset>
}
