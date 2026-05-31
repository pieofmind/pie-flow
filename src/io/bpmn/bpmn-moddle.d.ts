/** Minimal ambient types for `bpmn-moddle`. The package ships only runtime
 *  (it's a moddle-driven schema, types are too dynamic to ship statically),
 *  so we declare just enough surface for our import/export to typecheck. */
declare module "bpmn-moddle" {
  export interface ModdleAny {
    $type: string;
    id?: string;
    name?: string;
    [key: string]: unknown;
  }
  export interface ParseResult {
    rootElement: ModdleAny;
    warnings: Array<{ message?: string } | string>;
  }
  export interface SerializeResult { xml: string; }
  export interface SerializeOptions { format?: boolean; preamble?: boolean; }

  export class BpmnModdle {
    constructor(packages?: Record<string, unknown>, config?: Record<string, unknown>);
    fromXML(xml: string, typeName?: string): Promise<ParseResult>;
    toXML(element: ModdleAny, options?: SerializeOptions): Promise<SerializeResult>;
    create<T extends Record<string, unknown> = Record<string, unknown>>(
      typeName: string,
      properties?: T,
    ): ModdleAny;
  }
}

declare module "diagram-js/lib/layout/LayoutUtil" {
  export interface Bounds { x: number; y: number; width: number; height: number; }
  export interface Point { x: number; y: number; }
  /** Returns one of: 'intersect', 'top', 'bottom', 'left', 'right',
   *  'top-left', 'top-right', 'bottom-left', 'bottom-right'. */
  export function getOrientation(rect: Bounds, reference: Bounds | Point, padding?: number): string;
  export function getMid(element: Bounds): Point;
}
