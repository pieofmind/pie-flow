import { describe, it, expect, vi, beforeEach } from "vitest";
import { BpmnNativeController, MINIMAL_BPMN_XML } from "../../src/bpmn-native/BpmnNativeController";

const mockImportXML = vi.fn().mockResolvedValue({ warnings: [] });
const mockSaveXML = vi.fn().mockResolvedValue({ xml: "<xml>mocked</xml>" });
const mockSaveSVG = vi.fn().mockResolvedValue({ svg: "<svg>mocked</svg>" });
const mockOn = vi.fn();
const mockDestroy = vi.fn();

const mockSelection = {
  get: vi.fn().mockReturnValue([]),
};
const mockModeling = {
  updateProperties: vi.fn(),
};
const mockBpmnReplace = {
  replaceElement: vi.fn(),
};
const mockBpmnFactory = {
  create: vi.fn().mockImplementation((type, attrs) => ({ $type: type, ...attrs })),
};

const mockGet = vi.fn().mockImplementation((service) => {
  if (service === "selection") return mockSelection;
  if (service === "modeling") return mockModeling;
  if (service === "bpmnReplace") return mockBpmnReplace;
  if (service === "bpmnFactory") return mockBpmnFactory;
  return { zoom: vi.fn() };
});

vi.mock("bpmn-js/lib/Modeler", () => {
  return {
    default: vi.fn().mockImplementation(() => {
      return {
        importXML: mockImportXML,
        saveXML: mockSaveXML,
        saveSVG: mockSaveSVG,
        on: mockOn,
        get: mockGet,
        destroy: mockDestroy,
      };
    }),
  };
});

describe("BpmnNativeController", () => {
  let controller: BpmnNativeController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new BpmnNativeController();
  });

  describe("initial state", () => {
    it("should not be mounted initially", () => {
      expect(controller.isMounted).toBe(false);
    });
  });

  describe("mount", () => {
    it("should mount modeler and call importXML", async () => {
      const container = {} as HTMLElement;
      const result = await controller.mount(container, "<xml></xml>");

      expect(controller.isMounted).toBe(true);
      expect(mockImportXML).toHaveBeenCalledWith("<xml></xml>");
      expect(result.warnings).toEqual([]);
    });

    it("should use MINIMAL_BPMN_XML if empty string provided", async () => {
      const container = {} as HTMLElement;
      await controller.mount(container, "");

      expect(mockImportXML).toHaveBeenCalledWith(MINIMAL_BPMN_XML);
    });

    it("should register onChanged callback on commandStack.changed", async () => {
      const container = {} as HTMLElement;
      const callback = vi.fn();
      await controller.mount(container, "", callback);

      expect(mockOn).toHaveBeenCalledWith("commandStack.changed", callback);
    });

    it("should clean up and throw if importXML fails", async () => {
      mockImportXML.mockRejectedValueOnce(new Error("Import failed"));
      const container = {} as HTMLElement;

      await expect(controller.mount(container, "")).rejects.toThrow("Import failed");
      expect(controller.isMounted).toBe(false);
    });
  });

  describe("saveXml", () => {
    it("should throw when not mounted", async () => {
      await expect(controller.saveXml()).rejects.toThrow("modeler not mounted");
    });

    it("should call saveXML when mounted", async () => {
      const container = {} as HTMLElement;
      await controller.mount(container, "");
      const xml = await controller.saveXml();

      expect(xml).toBe("<xml>mocked</xml>");
      expect(mockSaveXML).toHaveBeenCalledWith({ format: true });
    });
  });

  describe("saveSvg", () => {
    it("should throw when not mounted", async () => {
      await expect(controller.saveSvg()).rejects.toThrow("modeler not mounted");
    });

    it("should call saveSVG when mounted", async () => {
      const container = {} as HTMLElement;
      await controller.mount(container, "");
      const svg = await controller.saveSvg();

      expect(svg).toBe("<svg>mocked</svg>");
      expect(mockSaveSVG).toHaveBeenCalled();
    });
  });

  describe("element operations & modeling", () => {
    let mockElement: any;

    beforeEach(async () => {
      mockElement = { businessObject: { id: "Start_1" } };
      const container = {} as HTMLElement;
      await controller.mount(container, "");
    });

    it("should return null for getSelectedElement if nothing selected", () => {
      mockSelection.get.mockReturnValueOnce([]);
      expect(controller.getSelectedElement()).toBeNull();
    });

    it("should return element if single element is selected", () => {
      mockSelection.get.mockReturnValueOnce([mockElement]);
      expect(controller.getSelectedElement()).toBe(mockElement);
    });

    it("should call modeling.updateProperties on updateProperties", () => {
      controller.updateProperties(mockElement, { name: "New Name" });
      expect(mockModeling.updateProperties).toHaveBeenCalledWith(mockElement, { name: "New Name" });
    });

    it("should call bpmnReplace.replaceElement on replaceElement", () => {
      controller.replaceElement(mockElement, "bpmn:UserTask");
      expect(mockBpmnReplace.replaceElement).toHaveBeenCalledWith(mockElement, { type: "bpmn:UserTask" });
    });

    it("should call modeling.updateProperties with documentation element", () => {
      controller.updateDocumentation(mockElement, "Simple Doc");
      expect(mockBpmnFactory.create).toHaveBeenCalledWith("bpmn:Documentation", { text: "Simple Doc" });
      expect(mockModeling.updateProperties).toHaveBeenCalledWith(mockElement, {
        documentation: [{ $type: "bpmn:Documentation", text: "Simple Doc" }],
      });
    });

    it("should update condition expression leaving gateway", () => {
      controller.updateConditionExpression(mockElement, "${approved}");
      expect(mockBpmnFactory.create).toHaveBeenCalledWith("bpmn:FormalExpression", { body: "${approved}" });
      expect(mockModeling.updateProperties).toHaveBeenCalledWith(mockElement, {
        conditionExpression: { $type: "bpmn:FormalExpression", body: "${approved}" },
      });
    });

    it("should delete condition expression if empty string is passed", () => {
      controller.updateConditionExpression(mockElement, "");
      expect(mockModeling.updateProperties).toHaveBeenCalledWith(mockElement, {
        conditionExpression: undefined,
      });
    });

    it("should update event definitions to message", () => {
      controller.updateEventDefinition(mockElement, "bpmn:MessageEventDefinition");
      expect(mockBpmnFactory.create).toHaveBeenCalledWith("bpmn:MessageEventDefinition");
      expect(mockModeling.updateProperties).toHaveBeenCalledWith(mockElement, {
        eventDefinitions: [{ $type: "bpmn:MessageEventDefinition" }],
      });
    });

    it("should empty event definitions if empty string is passed", () => {
      controller.updateEventDefinition(mockElement, "");
      expect(mockModeling.updateProperties).toHaveBeenCalledWith(mockElement, {
        eventDefinitions: [],
      });
    });

    it("should update loop characteristics to standard loop", () => {
      controller.updateLoopCharacteristics(mockElement, "standard");
      expect(mockBpmnFactory.create).toHaveBeenCalledWith("bpmn:StandardLoopCharacteristics");
      expect(mockModeling.updateProperties).toHaveBeenCalledWith(mockElement, {
        loopCharacteristics: { $type: "bpmn:StandardLoopCharacteristics" },
      });
    });

    it("should update loop characteristics to parallel multi-instance", () => {
      controller.updateLoopCharacteristics(mockElement, "parallel");
      expect(mockBpmnFactory.create).toHaveBeenCalledWith("bpmn:MultiInstanceLoopCharacteristics", { isSequential: false });
      expect(mockModeling.updateProperties).toHaveBeenCalledWith(mockElement, {
        loopCharacteristics: { $type: "bpmn:MultiInstanceLoopCharacteristics", isSequential: false },
      });
    });
  });

  describe("dispose", () => {
    it("should be safe to call dispose when not mounted", () => {
      expect(() => controller.dispose()).not.toThrow();
      expect(controller.isMounted).toBe(false);
    });

    it("should call destroy and reset state when mounted", async () => {
      const container = {} as HTMLElement;
      await controller.mount(container, "");
      controller.dispose();

      expect(controller.isMounted).toBe(false);
      expect(mockDestroy).toHaveBeenCalled();
    });

    it("should be safe to call dispose multiple times", () => {
      controller.dispose();
      controller.dispose();
      controller.dispose();
      expect(controller.isMounted).toBe(false);
    });
  });

  describe("MINIMAL_BPMN_XML", () => {
    it("should be valid XML with required BPMN namespaces", () => {
      expect(MINIMAL_BPMN_XML).toContain('xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"');
      expect(MINIMAL_BPMN_XML).toContain('xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"');
      expect(MINIMAL_BPMN_XML).toContain('xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"');
    });

    it("should contain process with start, task, and end events", () => {
      expect(MINIMAL_BPMN_XML).toContain('<process id="Process_1"');
      expect(MINIMAL_BPMN_XML).toContain('<startEvent id="Start_1"');
      expect(MINIMAL_BPMN_XML).toContain('<task id="Task_1"');
      expect(MINIMAL_BPMN_XML).toContain('<endEvent id="End_1"');
    });

    it("should contain sequence flows connecting elements", () => {
      expect(MINIMAL_BPMN_XML).toContain('sourceRef="Start_1" targetRef="Task_1"');
      expect(MINIMAL_BPMN_XML).toContain('sourceRef="Task_1" targetRef="End_1"');
    });

    it("should contain BPMNDiagram with shapes and edges", () => {
      expect(MINIMAL_BPMN_XML).toContain("<bpmndi:BPMNDiagram");
      expect(MINIMAL_BPMN_XML).toContain("<bpmndi:BPMNShape");
      expect(MINIMAL_BPMN_XML).toContain("<bpmndi:BPMNEdge");
      expect(MINIMAL_BPMN_XML).toContain("<dc:Bounds");
      expect(MINIMAL_BPMN_XML).toContain("<di:waypoint");
    });

    it("should be parseable XML", () => {
      expect(MINIMAL_BPMN_XML.trim()).toMatch(/^<\?xml version="1.0"/);
      expect(MINIMAL_BPMN_XML.trim()).toMatch(/<\/definitions>$/);
    });
  });
});
