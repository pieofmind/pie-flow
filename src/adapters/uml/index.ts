import { makeStubAdapter } from "../makeStubAdapter";

export const umlAdapter = makeStubAdapter({
  id: "uml",
  displayName: "UML Class",
  codeBlockLanguage: "uml",
  icon: "box",
  template: `@startuml
' @pos Customer: 100,50
class Customer {
  +id: int
  +name: string
  +placeOrder(): Order
}
@enduml`,
});
