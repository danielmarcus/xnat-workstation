/**
 * Copy core patient/study/frame identity fields from source DICOM metadata
 * into a derived SEG dataset before writing.
 */
export function applySourceDicomContextToSegDataset(
  dataset: any,
  sourceImageId: string,
  getMetaData: (type: string, imageId: string) => any,
): void {
  if (!dataset || !sourceImageId) return;

  const patient = getMetaData('patientModule', sourceImageId) as any;
  const study = getMetaData('generalStudyModule', sourceImageId) as any;
  const patientStudy = getMetaData('patientStudyModule', sourceImageId) as any;
  const imagePlane = getMetaData('imagePlaneModule', sourceImageId) as any;

  if (patient?.patientName) dataset.PatientName = patient.patientName;
  if (patient?.patientId) dataset.PatientID = patient.patientId;
  if (patient?.patientBirthDate) dataset.PatientBirthDate = patient.patientBirthDate;
  if (patient?.patientSex) dataset.PatientSex = patient.patientSex;

  if (study?.studyInstanceUID) dataset.StudyInstanceUID = study.studyInstanceUID;
  if (study?.studyDate) dataset.StudyDate = study.studyDate;
  if (study?.studyTime) dataset.StudyTime = study.studyTime;
  if (study?.studyID) dataset.StudyID = study.studyID;
  if (study?.accessionNumber) dataset.AccessionNumber = study.accessionNumber;
  if (study?.studyDescription) dataset.StudyDescription = study.studyDescription;
  if (study?.referringPhysicianName) dataset.ReferringPhysicianName = study.referringPhysicianName;

  if (patientStudy?.patientAge) dataset.PatientAge = patientStudy.patientAge;
  if (patientStudy?.patientWeight) dataset.PatientWeight = patientStudy.patientWeight;
  if (patientStudy?.patientSize) dataset.PatientSize = patientStudy.patientSize;

  if (imagePlane?.frameOfReferenceUID) {
    dataset.FrameOfReferenceUID = imagePlane.frameOfReferenceUID;
  }
}
