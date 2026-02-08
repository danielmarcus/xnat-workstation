/**
 * Minimal type declarations for dcmjs.
 *
 * dcmjs doesn't ship TypeScript declarations.
 * We only declare the parts we use: the data utilities.
 */
declare module 'dcmjs' {
  export namespace data {
    /** Convert a dcmjs dataset to a DICOM Blob. */
    function datasetToBlob(dataset: any): Blob;
    /** Convert a dcmjs dataset to a Node.js Buffer. */
    function datasetToBuffer(dataset: any): Buffer;
    /** Convert a dcmjs dataset to a DicomDict (which has a .write() method). */
    function datasetToDict(dataset: any): { write(): ArrayBuffer; [key: string]: any };
    /** DICOM Metadata Dictionary utilities. */
    const DicomMetaDictionary: {
      uid(): string;
      date(): string;
      time(): string;
      denaturalizeDataset(dataset: any, nameMap?: any): any;
      [key: string]: any;
    };
    /** DICOM dictionary container — wraps meta + dict for binary serialization. */
    const DicomDict: {
      new (meta: any): { meta: any; dict: any; write(): ArrayBuffer };
    };
  }
  export namespace normalizers {
    const SEGImageNormalizer: any;
  }
  export namespace derivations {
    const Segmentation: any;
  }
}
