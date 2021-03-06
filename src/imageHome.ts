import { MagickInputFile, MagickFile, asInputFile, getBuiltInImages } from '.'
import pMap from 'p-map'
import { values } from './util/misc'

/**
 * Manager for `MagickFiles`.
 */
export interface ImageHome {
  /**
   * Get a file by name.
   */
  get(name: string): Promise<MagickInputFile>

  /**
   * Programmatically add new files.
   */
  register(file: MagickFile, name?: string): void
  isRegistered(name: string): boolean
  /**
   * Get all the files currently available in this context.
   */
  getAll(): Promise<MagickInputFile[]>
  /**
   * Add ImageMagick built-in images like `rose:`, `logo:`, etc to this execution context so they are present in `getAll()`.
   */
  addBuiltInImages(): Promise<void>
  /**
   * Remove files by name.
   * @returns the files actually removed.
   */
  remove(names: string[]): MagickInputFile[]
}

type MagickInputFilePromise = Promise<MagickInputFile> & { resolved: true }

class ImageHomeImpl implements ImageHome {

  private images: { [name: string]: MagickInputFilePromise } = {}
  private builtInImagesAdded: boolean = false

  get(name: string): Promise<MagickInputFile> {
    return this.images[name]
  }

  remove(names: string[]): MagickInputFile[] {
    const result = []
    Object.keys(this.images).forEach(name => {
      if (names.indexOf(name) !== -1) {
        result.push(this.images[name])
        delete this.images[name]
      }
    })
    return result
  }

  async getAll(): Promise<MagickInputFile[]> {
    return await Promise.all(values(this.images))
  }

  register(file: MagickFile, name: string = file.name): MagickInputFilePromise {
    const promise = asInputFile(file) as MagickInputFilePromise
    this.images[name] = promise
    this.images[name].then(() => {
      promise.resolved = true
    })
    return promise
  }

  isRegistered(name: string, andReady: boolean = true): boolean {
    return this.images[name] && (andReady && this.images[name].resolved)
  }

  async addBuiltInImages() {
    if (!this.builtInImagesAdded) {
      await pMap(await getBuiltInImages(), img => this.register(img))
      this.builtInImagesAdded = true
    }
  }

}
export function createImageHome() { return new ImageHomeImpl() }
