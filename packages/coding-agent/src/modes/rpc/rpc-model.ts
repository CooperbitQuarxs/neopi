import { type Model, realizesPriorityServiceTier, serviceTierFamily } from "@oh-my-pi/pi-ai";

/** A model descriptor with the native `/fast` capability projected for RPC clients. */
export type RpcModel = Model & { supportsFastMode: boolean };

/** Copy a registry model without mixing capability with the session's requested or active tier. */
export function serializeRpcModel(model: Model): RpcModel {
	return {
		...model,
		supportsFastMode: serviceTierFamily(model) !== undefined && realizesPriorityServiceTier("priority", model),
	};
}
