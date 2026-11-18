// Escritura simulada (desarrollo sin Supabase y tests): registra las llamadas, no mueve datos.
import { randomUUID } from "node:crypto";
import { RpcError, type InventoryWriter, type RpcErrorCode } from "../drafts/writer-port";

export type WriterCall = { method: keyof InventoryWriter; args: unknown };

export class FixtureWriter implements InventoryWriter {
  readonly calls: WriterCall[] = [];
  /** Método que debe fallar y con qué código. */
  failOn: { method: keyof InventoryWriter; code: RpcErrorCode } | null = null;
  #movement = 1000;

  private record(method: keyof InventoryWriter, args: unknown): void {
    this.calls.push({ method, args });
    if (this.failOn?.method === method) throw new RpcError(this.failOn.code, `${method}: ${this.failOn.code}`);
  }

  async registerWaste(args: Parameters<InventoryWriter["registerWaste"]>[0]) {
    this.record("registerWaste", args);
    this.#movement += 1;
    return { movementId: String(this.#movement) };
  }

  async createTransfer(args: Parameters<InventoryWriter["createTransfer"]>[0]) {
    this.record("createTransfer", args);
    return { transferId: randomUUID() };
  }

  async openCount(args: Parameters<InventoryWriter["openCount"]>[0]) {
    this.record("openCount", args);
    return { countId: randomUUID() };
  }

  async addCountLines(args: Parameters<InventoryWriter["addCountLines"]>[0]) {
    this.record("addCountLines", args);
  }

  async receiveTransfer(transferId: string) {
    this.record("receiveTransfer", { transferId });
  }

  async cancelTransfer(transferId: string) {
    this.record("cancelTransfer", { transferId });
  }

  async sendOrder(orderId: string) {
    this.record("sendOrder", { orderId });
  }

  async receiveOrder(orderId: string, lines: Array<{ packId: string; packsQty: string; packPrice: string | null }>) {
    this.record("receiveOrder", { orderId, lines });
    return { receiptId: randomUUID() };
  }

  async cancelOrder(orderId: string) {
    this.record("cancelOrder", { orderId });
  }

  async sendTransfer(transferId: string) {
    this.record("sendTransfer", { transferId });
  }

  async deleteDraftTransfer(transferId: string) {
    this.record("deleteDraftTransfer", { transferId });
  }

  async createReceipt(args: Parameters<InventoryWriter["createReceipt"]>[0]) {
    this.record("createReceipt", args);
    return { receiptId: randomUUID() };
  }

  async postReceipt(receiptId: string) {
    this.record("postReceipt", { receiptId });
  }

  async deleteOpenReceipt(receiptId: string) {
    this.record("deleteOpenReceipt", { receiptId });
  }

  async closeCount(countId: string, zeroUncounted: boolean, asConsumption: boolean) {
    this.record("closeCount", { countId, zeroUncounted, asConsumption });
  }

  async linkSupplier(args: Parameters<InventoryWriter["linkSupplier"]>[0]) {
    this.record("linkSupplier", args);
  }

  async setSupplierPrice(args: Parameters<InventoryWriter["setSupplierPrice"]>[0]) {
    this.record("setSupplierPrice", args);
  }

  async createProduct(args: Parameters<InventoryWriter["createProduct"]>[0]) {
    this.record("createProduct", args);
    return { productId: randomUUID() };
  }

  async setLocationLevel(args: Parameters<InventoryWriter["setLocationLevel"]>[0]) {
    this.record("setLocationLevel", args);
  }

  async createOrder(args: Parameters<InventoryWriter["createOrder"]>[0]) {
    this.record("createOrder", args);
    return { orderId: randomUUID() };
  }

  async archiveProduct(productId: string) {
    this.record("archiveProduct", { productId });
  }

  async markInvoicePaid(invoiceId: string, day: string) {
    this.record("markInvoicePaid", { invoiceId, day });
  }

  async submitAreaMove(args: Parameters<InventoryWriter["submitAreaMove"]>[0]) {
    this.record("submitAreaMove", args);
  }

  async updateProductSheet(args: Parameters<InventoryWriter["updateProductSheet"]>[0]) {
    this.record("updateProductSheet", args);
  }

  async createArea(args: Parameters<InventoryWriter["createArea"]>[0]) {
    this.record("createArea", args);
  }

  async importSales(args: Parameters<InventoryWriter["importSales"]>[0]) {
    this.record("importSales", args);
    return { unlinked: 0 };
  }

  async linkSalesItem(link: Parameters<InventoryWriter["linkSalesItem"]>[0]) {
    this.record("linkSalesItem", link);
  }

  async editRecipeLines(recipeId: string, changes: Parameters<InventoryWriter["editRecipeLines"]>[1]) {
    this.record("editRecipeLines", { recipeId, changes });
  }

  async createRecipe(args: Parameters<InventoryWriter["createRecipe"]>[0]) {
    this.record("createRecipe", args);
  }

  async addPack(args: Parameters<InventoryWriter["addPack"]>[0]) {
    this.record("addPack", args);
  }

  async setRecipePrice(recipeId: string, price: string) {
    this.record("setRecipePrice", { recipeId, price });
  }

  async setSupplierTerms(supplierId: string, terms: Array<{ field: string; value: string }>) {
    this.record("setSupplierTerms", { supplierId, terms });
  }

  async validateAreaMoves(moveIds: string[]) {
    this.record("validateAreaMoves", { moveIds });
    return { validated: moveIds.length, skipped: 0 };
  }
}
