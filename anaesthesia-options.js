// Shared choices and visibility rules for the Anaesthesia form.
const procedureGroups = [
  ['Airway', ['Fibreoptic Intubation','Videolaryngoscopy','DLT / OLV','Jet Ventilation','Bronchoscopy']],
  ['Neuraxial Technique', ['SAB','CSE','Lumbar Epidural','Thoracic Epidural','Caudal']],
  ['Lines', ['Arterial Line','CVL','PA Catheter']],
  ['Others', ['Chest Tube','Percutaneous Tracheostomy']]
];
const anaesthesiaOptionSets = {
  comorbidities: ['Hypertension','Diabetes mellitus','Dyslipidemia','Ischaemic heart disease','Heart failure','Valvular heart disease','Arrhythmia','Asthma','COPD','OSA','Obesity','CKD','Liver disease','Stroke','Epilepsy','Thyroid disease','Bleeding disorder','Other'],
  skills: procedureGroups.flatMap(([,options]) => options),
  airway: ['ETT','SGA','Facemask','Nasal Prong'],
  cvlSite: ['Subclavian','IJV','Femoral'],
  paFloat: ['Float'],
  // Nerve block choices adapted from Syazie's logbook.
  peripheralBlocks: ['Interscalene','Supra / infraclavicular','Axillary','Wrist / elbow','Lumbar plexus','Femoral','Adductor canal','Sciatic','Popliteal','Ankle','TAP','ESP','Fascia iliaca / PENG','Scalp','II / IH','Penile','Other block']
};
function normaliseAnaesthesiaDetails(data) {
  const aliases = {
    comorbidities: {'Chronic obstructive pulmonary disease (COPD)':'COPD','Obstructive sleep apnoea':'OSA','Chronic kidney disease':'CKD'},
    skills: {'CVL insertion':'CVL','Arterial Line insertion':'Arterial Line'},
    airway: {'Endotracheal tube':'ETT','Supraglottic airway':'SGA','Face mask':'Facemask'}
  };
  for (const key of Object.keys(anaesthesiaOptionSets)) {
    const values = Array.isArray(data[key]) ? data[key] : data[key] ? [String(data[key])] : [];
    data[key] = [...new Set(values.map(value => aliases[key]?.[value] || value))];
  }
  if (data.specialty === 'Radiology') data.specialty = 'Radiological Scans';
  data.bmi = data.bmi ?? '';
  return data;
}
function anaesthesiaVisibility(technique, skills, comorbidities, blocks) {
  return {
    airway: ['General anaesthesia','General + regional','Total Intravenous Anaesthesia (TIVA)','Sedation','Monitored anaesthesia care'].includes(technique),
    peripheralBlocks: ['Peripheral nerve block','General + regional'].includes(technique),
    bmi: comorbidities.includes('Obesity'),
    cvlSite: skills.includes('CVL'),
    paFloat: skills.includes('PA Catheter'),
    regionalBlock: skills.includes('Regional Block') || blocks.includes('Other block'),
    otherTechniques: skills.includes('Other techniques')
  };
}
function frequentProcedures(rows) {
  const choices = anaesthesiaOptionSets.skills;
  const defaults = ['Videolaryngoscopy','Arterial Line','CVL','SAB','CSE'];
  // Fixed starter shortcuts during design review; enable frequency ranking after review.
  const useFrequencyRanking = false;
  if (!useFrequencyRanking) return defaults;
  const counts = new Map();
  for (const row of rows) for (const value of new Set(row.skills || [])) if (choices.includes(value)) counts.set(value,(counts.get(value) || 0) + 1);
  return [...new Set([...counts.keys()].sort((a,b) => counts.get(b)-counts.get(a) || choices.indexOf(a)-choices.indexOf(b)).concat(defaults,choices))].slice(0,5);
}
