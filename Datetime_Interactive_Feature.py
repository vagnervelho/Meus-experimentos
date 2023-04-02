
# coding: utf-8

# In[ ]:


import datetime as dt

nome = input("\nQual é o seu nome? ")

print("\nBom dia," + nome + "!")

print("\nEu sou um programa pra te falar qual é a data e hora atuais!")

print("\nO dia de hoje é:", dt.datetime.strftime(dt.datetime.now(), "%d/%m/%Y"))

print("\nE a hora atual é:", dt.datetime.strftime(dt.datetime.now(), "%H:%M:%S"))

resposta = input("\nVocê deseja fechar o programa? (s/n) ")

while resposta.lower() != "s":

    resposta = input("\nVocê deseja fechar o programa? (s/n) ")


# %%
s
s