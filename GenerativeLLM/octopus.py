from transformers import AutoTokenizer, GemmaForCausalLM
import torch
import time

def inference(input_text):
    start_time = time.time()
    input_ids = tokenizer(input_text, return_tensors="pt").to(model.device)
    input_length = input_ids["input_ids"].shape[1]
    outputs = model.generate(
        input_ids=input_ids["input_ids"], 
        max_length=1024,
        do_sample=False)
    generated_sequence = outputs[:, input_length:].tolist()
    res = tokenizer.decode(generated_sequence[0])
    end_time = time.time()
    return {"output": res, "latency": end_time - start_time}

model_id = "NexaAIDev/Octopus-v2"
tokenizer = AutoTokenizer.from_pretrained(model_id)
model = GemmaForCausalLM.from_pretrained(
    model_id, torch_dtype=torch.float16, device_map="auto"
)

input_text = "It shows the performance of attacks on the CelebAHQ and DreamBooth dataset. We can see that the fine-tuned model is good enough to embed the special identities into the images. Our attack method can successfully reconstruct the same identities in private images with close similarity scores as DreamBooth. We can see on the CelebAHQ dataset, the similarity between our reconstructed and private images is even higher than 0.9, which means successful reconstruction of the same identity. Our attack method is effective in reconstructing private information."
nexa_query = f"Bellow is a paragraph in the paper. Please revise it to make it as a academic paper and easy to understand\n\nQuery: {input_text} \n\nResponse:"
start_time = time.time()
print("nexa model result:\n", inference(nexa_query))
print("latency:", time.time() - start_time," s")
